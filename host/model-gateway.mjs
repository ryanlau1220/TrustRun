import { unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";

const GONKA_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function reject(response, statusCode) {
	response.writeHead(statusCode, {
		"content-type": "application/json",
		connection: "close",
	});
	response.end(
		JSON.stringify({
			error: { message: "TrustRun model gateway rejected this request." },
		}),
	);
}

function readBody(request, response) {
	const length = request.headers["content-length"];
	if (
		length != null &&
		(!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)
	) {
		reject(response, 413);
		request.destroy();
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		request.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_REQUEST_BYTES) {
				reject(response, 413);
				request.destroy();
			} else {
				chunks.push(chunk);
			}
		});
		request.once("end", () =>
			resolve(response.writableEnded ? null : Buffer.concat(chunks)),
		);
		request.once("error", () => resolve(null));
	});
}

function text(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) throw new Error("invalid message content");
	return content
		.map((part) => {
			if (
				(part?.type === "input_text" || part?.type === "output_text") &&
				typeof part.text === "string"
			)
				return part.text;
			throw new Error("unsupported message content");
		})
		.join("\n");
}

function functions(tools) {
	const namespaces = new Map();
	const result = [];
	const add = (tool, namespace) => {
		if (
			tool?.type !== "function" ||
			typeof tool.name !== "string" ||
			!tool.parameters ||
			typeof tool.parameters !== "object"
		)
			return;
		if (namespace) namespaces.set(tool.name, namespace);
		result.push({
			type: "function",
			function: {
				name: tool.name,
				description:
					typeof tool.description === "string" ? tool.description : undefined,
				parameters: tool.parameters,
				strict: tool.strict === true,
			},
		});
	};
	for (const tool of tools ?? []) {
		if (
			tool?.type === "namespace" &&
			typeof tool.name === "string" &&
			Array.isArray(tool.tools)
		) {
			for (const child of tool.tools) add(child, tool.name);
		} else {
			add(tool);
		}
	}
	return { namespaces, result };
}

function chatRequest(body) {
	if (!Array.isArray(body.input)) throw new Error("invalid input");
	const messages = [];
	if (typeof body.instructions === "string" && body.instructions)
		messages.push({ role: "system", content: body.instructions });
	for (const item of body.input) {
		if (
			item?.type === "message" &&
			["developer", "system", "user", "assistant"].includes(item.role)
		) {
			messages.push({
				role: item.role === "developer" ? "system" : item.role,
				content: text(item.content),
			});
		} else if (
			item?.type === "function_call" &&
			typeof item.name === "string" &&
			typeof item.call_id === "string"
		) {
			messages.push({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: item.call_id,
						type: "function",
						function: {
							name: item.name,
							arguments:
								typeof item.arguments === "string" ? item.arguments : "{}",
						},
					},
				],
			});
		} else if (
			item?.type === "function_call_output" &&
			typeof item.call_id === "string"
		) {
			messages.push({
				role: "tool",
				tool_call_id: item.call_id,
				content:
					typeof item.output === "string"
						? item.output
						: JSON.stringify(item.output ?? {}),
			});
		} else {
			throw new Error("unsupported input item");
		}
	}
	const tools = functions(body.tools);
	const request = { model: GONKA_MODEL, messages, stream: false };
	if (tools.result.length) request.tools = tools.result;
	if (
		body.tool_choice === "auto" ||
		body.tool_choice === "required" ||
		body.tool_choice === "none"
	)
		request.tool_choice = body.tool_choice;
	if (body.parallel_tool_calls === true) request.parallel_tool_calls = true;
	return {
		body: Buffer.from(JSON.stringify(request)),
		namespaces: tools.namespaces,
	};
}

function forwardToGonka(body, apiKey) {
	return httpsRequest({
		hostname: "api.gonkarouter.io",
		port: 443,
		method: "POST",
		path: "/v1/chat/completions",
		rejectUnauthorized: true,
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json",
			"content-type": "application/json",
			"content-length": String(body.length),
			"user-agent": "TrustRun-Model-Gateway/1",
		},
	});
}

function responseBase(output, usage) {
	const input = Number.isInteger(usage?.prompt_tokens)
		? usage.prompt_tokens
		: 0;
	const outputTokens = Number.isInteger(usage?.completion_tokens)
		? usage.completion_tokens
		: 0;
	return {
		id: "resp_trustrun",
		object: "response",
		created_at: Math.floor(Date.now() / 1000),
		status: "completed",
		error: null,
		incomplete_details: null,
		model: GONKA_MODEL,
		output,
		usage: {
			input_tokens: input,
			input_tokens_details: { cached_tokens: 0 },
			output_tokens: outputTokens,
			output_tokens_details: { reasoning_tokens: 0 },
			total_tokens: input + outputTokens,
		},
	};
}

function event(response, value) {
	response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
}

function respond(response, chat, namespaces) {
	const message = chat?.choices?.[0]?.message;
	if (
		!message ||
		(message.content != null && typeof message.content !== "string") ||
		(message.tool_calls != null && !Array.isArray(message.tool_calls))
	)
		return reject(response, 502);
	const output = [];
	if (message.content)
		output.push({
			id: "msg_trustrun",
			type: "message",
			status: "completed",
			role: "assistant",
			content: [
				{ type: "output_text", text: message.content, annotations: [] },
			],
		});
	for (const [index, call] of (message.tool_calls ?? []).entries()) {
		if (
			typeof call?.id !== "string" ||
			typeof call?.function?.name !== "string" ||
			typeof call.function.arguments !== "string"
		)
			return reject(response, 502);
		output.push({
			id: `fc_trustrun_${index}`,
			type: "function_call",
			status: "completed",
			call_id: call.id,
			name: call.function.name,
			...(namespaces.get(call.function.name) && {
				namespace: namespaces.get(call.function.name),
			}),
			arguments: call.function.arguments,
		});
	}
	const completed = responseBase(output, chat.usage);
	const started = {
		...completed,
		status: "in_progress",
		output: [],
		usage: null,
	};
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-store",
	});
	let sequence = 1;
	event(response, {
		type: "response.created",
		sequence_number: sequence++,
		response: started,
	});
	for (const [index, item] of output.entries()) {
		if (item.type === "message") {
			const part = item.content[0];
			event(response, {
				type: "response.output_item.added",
				sequence_number: sequence++,
				output_index: index,
				item: { ...item, status: "in_progress", content: [] },
			});
			event(response, {
				type: "response.content_part.added",
				sequence_number: sequence++,
				item_id: item.id,
				output_index: index,
				content_index: 0,
				part: { ...part, text: "" },
			});
			event(response, {
				type: "response.output_text.delta",
				sequence_number: sequence++,
				item_id: item.id,
				output_index: index,
				content_index: 0,
				delta: part.text,
			});
		} else {
			event(response, {
				type: "response.output_item.added",
				sequence_number: sequence++,
				output_index: index,
				item: { ...item, status: "in_progress", arguments: "" },
			});
			event(response, {
				type: "response.function_call_arguments.done",
				sequence_number: sequence++,
				item_id: item.id,
				output_index: index,
				arguments: item.arguments,
			});
		}
		event(response, {
			type: "response.output_item.done",
			sequence_number: sequence++,
			output_index: index,
			item,
		});
	}
	event(response, {
		type: "response.completed",
		sequence_number: sequence,
		response: completed,
	});
	response.end();
}

export function createModelGateway({ apiKey, forward = forwardToGonka }) {
	if (!apiKey) throw new Error("GONKA_API_KEY is required");
	return createServer(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/v1/responses")
			return reject(response, 404);
		if (
			request.headers["content-type"]?.split(";", 1)[0] !== "application/json"
		)
			return reject(response, 415);
		const input = await readBody(request, response);
		if (input == null) return;
		let outbound;
		try {
			outbound = chatRequest(JSON.parse(input));
		} catch {
			return reject(response, 400);
		}
		let upstream;
		try {
			upstream = forward(outbound.body, apiKey);
		} catch {
			return reject(response, 502);
		}
		upstream.once("error", () =>
			response.headersSent ? response.destroy() : reject(response, 502),
		);
		upstream.once("response", (upstreamResponse) => {
			const declaredLength = Number(
				upstreamResponse.headers["content-length"] ?? 0,
			);
			if (declaredLength > MAX_RESPONSE_BYTES) {
				upstreamResponse.destroy();
				return reject(response, 502);
			}
			const chunks = [];
			let size = 0;
			upstreamResponse.on("data", (chunk) => {
				size += chunk.length;
				if (size > MAX_RESPONSE_BYTES) upstreamResponse.destroy();
				else chunks.push(chunk);
			});
			upstreamResponse.once("error", () =>
				response.headersSent ? response.destroy() : reject(response, 502),
			);
			upstreamResponse.once("end", () => {
				const body = Buffer.concat(chunks);
				if (
					(upstreamResponse.statusCode ?? 502) < 200 ||
					(upstreamResponse.statusCode ?? 502) >= 300
				) {
					response.writeHead(upstreamResponse.statusCode ?? 502, {
						"content-type": "application/json",
						"cache-control": "no-store",
					});
					return response.end(body);
				}
				try {
					respond(response, JSON.parse(body), outbound.namespaces);
				} catch {
					reject(response, 502);
				}
			});
		});
		upstream.end(outbound.body);
	});
}

async function main() {
	const socketPath = process.env.TRUSTRUN_MODEL_SOCKET;
	if (!socketPath) throw new Error("TRUSTRUN_MODEL_SOCKET is required");
	await unlink(socketPath).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	createModelGateway({ apiKey: process.env.GONKA_API_KEY }).listen({
		path: socketPath,
		readableAll: false,
		writableAll: false,
	});
}

if (import.meta.main)
	main().catch((error) => {
		process.stderr.write(`TrustRun model gateway failed: ${error.message}\n`);
		process.exitCode = 1;
	});
