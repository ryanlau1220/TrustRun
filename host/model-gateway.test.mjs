import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelGateway } from "./model-gateway.mjs";

function request(socketPath, requestText) {
	return new Promise((resolve, reject) => {
		const socket = createConnection({ path: socketPath });
		let output = "";
		socket.on("data", (chunk) => {
			output += chunk;
		});
		socket.once("error", reject);
		socket.once("end", () => resolve(output));
		socket.end(requestText);
	});
}

const directory = await mkdtemp(join(tmpdir(), "trustrun-model-test-"));
const socketPath = join(directory, "gateway.sock");
let forwarded = 0;
const gateway = createModelGateway({
	apiKey: "host-only-key",
	forward(body, apiKey) {
		forwarded += 1;
		assert.equal(apiKey, "host-only-key");
		assert.deepEqual(JSON.parse(body), {
			model: "deepseek-ai/DeepSeek-V4-Flash-0731",
			messages: [
				{ role: "system", content: "trusted instructions" },
				{ role: "user", content: "status please" },
			],
			stream: false,
			tools: [
				{
					type: "function",
					function: {
						name: "service_status",
						description: "status",
						parameters: { type: "object" },
						strict: true,
					},
				},
			],
			tool_choice: "auto",
			parallel_tool_calls: true,
		});
		const upstream = new EventEmitter();
		upstream.end = () => {
			const response = new EventEmitter();
			response.statusCode = 200;
			response.headers = { "content-type": "application/json" };
			upstream.emit("response", response);
			response.emit(
				"data",
				Buffer.from(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "ok",
									tool_calls: [
										{
											id: "call_status",
											function: {
												name: "service_status",
												arguments: "{}",
											},
										},
									],
								},
							},
						],
						usage: { prompt_tokens: 3, completion_tokens: 2 },
					}),
				),
			);
			response.emit("end");
		};
		return upstream;
	},
});
await new Promise((resolve) => gateway.listen(socketPath, resolve));

const unknown = await request(
	socketPath,
	"POST /v1/chat/completions HTTP/1.1\r\nHost: gateway\r\nContent-Length: 0\r\n\r\n",
);
assert.match(unknown, /^HTTP\/1\.1 404/);
assert.equal(forwarded, 0);

const body = JSON.stringify({
	instructions: "trusted instructions",
	input: [
		{
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: "status please" }],
		},
	],
	tools: [
		{
			type: "namespace",
			name: "mcp__trustrun",
			description: "TrustRun MCP tools",
			tools: [
				{
					type: "function",
					name: "service_status",
					description: "status",
					parameters: { type: "object" },
					strict: true,
				},
			],
		},
		{ type: "namespace", name: "ignored", tools: [] },
	],
	tool_choice: "auto",
	parallel_tool_calls: true,
	stream: true,
});
const accepted = await request(
	socketPath,
	`POST /v1/responses HTTP/1.1\r\nHost: gateway\r\nAuthorization: Bearer sandbox-value\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
);
assert.match(accepted, /^HTTP\/1\.1 200/);
assert.match(accepted, /response\.output_text\.delta/);
assert.match(accepted, /response\.function_call_arguments\.done/);
assert.match(accepted, /"namespace":"mcp__trustrun"/);
assert.match(accepted, /response\.completed/);
assert.equal(forwarded, 1);

await new Promise((resolve) => gateway.close(resolve));
await rm(directory, { recursive: true, force: true });
console.log("model gateway checks passed");
