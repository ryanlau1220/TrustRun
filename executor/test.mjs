import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutor, RestartState } from "./server.mjs";

const directory = mkdtempSync(join(tmpdir(), "trustrun-"));
const state = new RestartState(join(directory, "state.db"), 1_000);
assert.equal(state.reserve(10), "granted");
assert.equal(state.reserve(11), "in_flight");
state.complete();
assert.equal(state.reserve(12), "cooldown");
assert.equal(state.reserve(1_010), "granted");
state.close();

execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "ignore" });
const executor = createExecutor({ bearer: "test-bearer", certPath: join(directory, "cert.pem"), keyPath: join(directory, "key.pem"), statePath: join(directory, "executor.db"), restartHelper: "/bin/false", cooldownMs: 1_000 });
assert.equal(executor.maxConnections, 16);
assert.equal(executor.headersTimeout, 5_000);
assert.equal(executor.requestTimeout, 10_000);
await new Promise((resolve) => executor.listen(0, "127.0.0.1", resolve));
const port = executor.address().port;
const call = (path, body, authorization, contentType = "application/json") => new Promise((resolve, reject) => {
  const req = request({ hostname: "127.0.0.1", port, path, method: "POST", rejectUnauthorized: false, headers: { "content-type": contentType, "content-length": Buffer.byteLength(body), ...(authorization ? { authorization } : {}) } }, (res) => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
  });
  req.once("error", reject);
  req.end(body);
});
assert.deepEqual(await call("/v1/service/status", "{}"), { status: 401, body: { ok: false, code: "unauthorized" } });
assert.deepEqual(await call("/v1/service/status", "{}", "Bearer test-bearer", "text/plain"), { status: 400, body: { ok: false, code: "invalid_request" } });
assert.deepEqual(await call("/v1/service/status", '{"service":"other"}', "Bearer test-bearer"), { status: 400, body: { ok: false, code: "invalid_request" } });
await new Promise((resolve) => executor.close(resolve));
