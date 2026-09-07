import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createModelGateway } from "./model-gateway.mjs";

function request(socketPath, requestText) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let output = "";
    socket.on("data", (chunk) => { output += chunk; });
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
    assert.equal(body.toString(), '{"model":"gpt-5.3-codex"}');
    const upstream = new EventEmitter();
    upstream.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };
      response.pipe = (destination) => destination.end('{"ok":true}');
      upstream.emit("response", response);
    };
    return upstream;
  },
});
await new Promise((resolve) => gateway.listen(socketPath, resolve));

const unknown = await request(socketPath, "POST /v1/models HTTP/1.1\r\nHost: gateway\r\nContent-Length: 0\r\n\r\n");
assert.match(unknown, /^HTTP\/1\.1 404/);
assert.equal(forwarded, 0);

const body = '{"model":"gpt-5.3-codex"}';
const accepted = await request(socketPath, `POST /v1/responses HTTP/1.1\r\nHost: gateway\r\nAuthorization: Bearer sandbox-value\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
assert.match(accepted, /^HTTP\/1\.1 200/);
assert.match(accepted, /\{"ok":true\}/);
assert.equal(forwarded, 1);

await new Promise((resolve) => gateway.close(resolve));
await rm(directory, { recursive: true, force: true });
console.log("model gateway checks passed");
