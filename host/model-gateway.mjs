import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { unlink } from "node:fs/promises";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function reject(response, statusCode) {
  response.writeHead(statusCode, { "content-type": "application/json", connection: "close" });
  response.end(JSON.stringify({ error: { message: "TrustRun model gateway rejected this request." } }));
}

function readBody(request, response) {
  const length = request.headers["content-length"];
  if (length != null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
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
    request.once("end", () => resolve(response.writableEnded ? null : Buffer.concat(chunks)));
    request.once("error", () => resolve(null));
  });
}

function forwardToOllama(body) {
  return httpRequest({
    hostname: "127.0.0.1",
    port: 11434,
    method: "POST",
    path: "/v1/responses",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "content-length": String(body.length),
      "user-agent": "TrustRun-Model-Gateway/1",
    },
  });
}

export function createModelGateway({ forward = forwardToOllama } = {}) {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") return reject(response, 404);
    if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") return reject(response, 415);
    const body = await readBody(request, response);
    if (body == null) return;

    let upstream;
    try {
      upstream = forward(body);
    } catch {
      return reject(response, 502);
    }
    upstream.once("error", () => {
      if (!response.headersSent) reject(response, 502);
      else response.destroy();
    });
    upstream.once("response", (upstreamResponse) => {
      const declaredLength = Number(upstreamResponse.headers["content-length"] ?? 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        upstreamResponse.destroy();
        return reject(response, 502);
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, {
        "content-type": upstreamResponse.headers["content-type"] ?? "application/json",
        "cache-control": "no-store",
      });
      let size = 0;
      upstreamResponse.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          upstreamResponse.destroy();
          response.destroy();
        }
      });
      upstreamResponse.pipe(response);
    });
    upstream.end(body);
  });
}

async function main() {
  const socketPath = process.env.TRUSTRUN_MODEL_SOCKET;
  if (!socketPath) throw new Error("TRUSTRUN_MODEL_SOCKET is required");
  await unlink(socketPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const server = createModelGateway();
  server.listen({ path: socketPath, readableAll: false, writableAll: false });
}

if (import.meta.main) main().catch((error) => {
  process.stderr.write(`TrustRun model gateway failed: ${error.message}\n`);
  process.exitCode = 1;
});
