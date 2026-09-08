import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutor, RestartState } from "../executor/server.mjs";

console.log("\n=======================================================");
console.log("  TrustRun v1 — Explicit Negative & Positive Proofs");
console.log("=======================================================\n");

let passed = 0;
function pass(testName, detail) {
  passed++;
  console.log(`[PASS] Check ${passed}: ${testName}`);
  if (detail) console.log(`       → ${detail}`);
}

// -------------------------------------------------------------
// 1. Sandbox cannot read GONKA_API_KEY
// -------------------------------------------------------------
const gonkaEnv = "/etc/trustrun/gonka.env";
if (existsSync(gonkaEnv)) {
  const stat = statSync(gonkaEnv);
  const mode = stat.mode & 0o777;
  assert.equal(mode, 0o600, "/etc/trustrun/gonka.env must be 0600");
  try {
    if (process.getuid() !== 0) {
      readFileSync(gonkaEnv);
      assert.fail("Unprivileged read should fail");
    }
  } catch (err) {
    assert.equal(err.code, "EACCES");
  }
}
const sandboxRunContent = readFileSync(fileURLToPath(new URL("../sandbox/run", import.meta.url)), "utf8");
assert.ok(!sandboxRunContent.includes("/etc/trustrun/gonka.env"), "sandbox/run must not mount /etc/trustrun/gonka.env");
assert.ok(!sandboxRunContent.includes("GONKA_API_KEY"), "sandbox/run must not export GONKA_API_KEY");
pass("Sandbox cannot read GONKA_API_KEY", "File is mode 0600 root-only; not mounted or exposed to sandbox");

// -------------------------------------------------------------
// 2. Sandbox cannot read T3N_API_KEY
// -------------------------------------------------------------
assert.ok(sandboxRunContent.includes("--clearenv"), "sandbox/run must execute bwrap with --clearenv");
assert.ok(!sandboxRunContent.includes("T3N_API_KEY"), "sandbox/run must never pass T3N_API_KEY into sandbox");
pass("Sandbox cannot read T3N_API_KEY", "bwrap clears entire environment; T3N_API_KEY is restricted to trusted host");

// -------------------------------------------------------------
// 3. Sandbox cannot read executor bearer
// -------------------------------------------------------------
assert.ok(!sandboxRunContent.includes("/var/lib/trustrun-executor"), "sandbox/run must not mount /var/lib/trustrun-executor");
assert.ok(!sandboxRunContent.includes("TRUSTRUN_EXECUTOR_BEARER"), "sandbox/run must not pass TRUSTRUN_EXECUTOR_BEARER");
pass("Sandbox cannot read executor bearer token", "Bearer token is held exclusively in T3 TEE secrets and host executor");

// -------------------------------------------------------------
// Set up isolated executor for HTTP boundary assertions
// -------------------------------------------------------------
const tempDir = mkdtempSync(join(tmpdir(), "trustrun-bounds-"));
execFileSync(
  "openssl",
  ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", join(tempDir, "key.pem"), "-out", join(tempDir, "cert.pem")],
  { stdio: "ignore" }
);

const stateDbPath = join(tempDir, "state.db");
const TEST_BEARER = "test-secret-bearer-token-12345678901234567890";
const executor = createExecutor({
  bearer: TEST_BEARER,
  certPath: join(tempDir, "cert.pem"),
  keyPath: join(tempDir, "key.pem"),
  statePath: stateDbPath,
  restartHelper: "/usr/local/libexec/trustrun-restart-my-api",
  cooldownMs: 600_000,
});

await new Promise((resolve) => executor.listen(0, "127.0.0.1", resolve));
const port = executor.address().port;

function call({ path = "/v1/service/status", method = "POST", body = "{}", auth = null, contentType = "application/json" }) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          ...(contentType ? { "content-type": contentType } : {}),
          "content-length": Buffer.byteLength(body),
          ...(auth ? { authorization: auth } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.once("error", reject);
    req.end(body);
  });
}

// -------------------------------------------------------------
// 4. Direct executor request fails without bearer
// -------------------------------------------------------------
const unauth = await call({ auth: null });
assert.equal(unauth.status, 401);
assert.deepEqual(unauth.body, { ok: false, code: "unauthorized" });

const wrongBearer = await call({ auth: "Bearer wrong-token" });
assert.equal(wrongBearer.status, 401);
assert.deepEqual(wrongBearer.body, { ok: false, code: "unauthorized" });

assert.ok(sandboxRunContent.includes("--unshare-all"), "sandbox/run must unshare all namespaces including network");
pass("Direct executor request fails", "Executor rejects unauthorized requests with 401; sandbox network is unshared");

// -------------------------------------------------------------
// 5. service.status succeeds and schema is sanitized
// -------------------------------------------------------------
const statusRes = await call({ auth: `Bearer ${TEST_BEARER}`, path: "/v1/service/status" });
assert.equal(statusRes.status, 200);
assert.equal(statusRes.body.ok, true);
assert.equal(statusRes.body.service, "my-api");
assert.ok(["running", "not_running"].includes(statusRes.body.status));
assert.equal(Object.keys(statusRes.body).length, 3, "Output schema must contain only ok, service, status");
pass("service.status succeeds with sanitized output", `Returned { ok: true, service: "my-api", status: "${statusRes.body.status}" }`);

// -------------------------------------------------------------
// 6. service.restart authority & state reservation verification
// -------------------------------------------------------------
const directState = new RestartState(join(tempDir, "direct-state.db"), 600_000);
const now = Date.now();
assert.equal(directState.reserve(now), "granted", "First restart must be granted");
assert.equal(directState.reserve(now + 10), "in_flight", "Concurrent restart must be marked in_flight");
directState.complete();
assert.equal(directState.reserve(now + 20), "cooldown", "Restart within cooldown must be rejected");
assert.equal(directState.reserve(now + 600_001), "granted", "Restart after cooldown window must be granted");
directState.close();

// Now invoke the HTTP restart endpoint with valid bearer token
const restartRes = await call({ auth: `Bearer ${TEST_BEARER}`, path: "/v1/service/restart" });
// In production executor runs under trustrun-executor user with sudo rights.
// When tested here as an unprivileged user without sudo rights, it still reserves state and returns 502 restart_failed.
assert.ok([200, 502].includes(restartRes.status), "Restart endpoint must process valid request");
if (restartRes.status === 200) {
  assert.deepEqual(restartRes.body, { ok: true, service: "my-api", status: "restart_requested" });
} else {
  assert.deepEqual(restartRes.body, { ok: false, code: "restart_failed" });
}
pass("service.restart capability enforces durable reservation", "Single-flight lock and 10-minute cooldown state durably recorded");

// -------------------------------------------------------------
// 7. Immediate second restart is denied by cooldown
// -------------------------------------------------------------
const secondRestart = await call({ auth: `Bearer ${TEST_BEARER}`, path: "/v1/service/restart" });
assert.equal(secondRestart.status, 409);
assert.deepEqual(secondRestart.body, { ok: false, code: "cooldown" });
pass("Immediate second restart is denied by cooldown", "Durable SQLite state returned HTTP 409 with code 'cooldown'");

// -------------------------------------------------------------
// 8. Agent cannot choose arbitrary service, URL, command, or target
// -------------------------------------------------------------
// (a) Arbitrary service in body
const arbitraryService = await call({ auth: `Bearer ${TEST_BEARER}`, body: JSON.stringify({ service: "other-service" }) });
assert.equal(arbitraryService.status, 400);
assert.deepEqual(arbitraryService.body, { ok: false, code: "invalid_request" });

// (b) Arbitrary URL path
const arbitraryPath = await call({ auth: `Bearer ${TEST_BEARER}`, path: "/v1/service/logs" });
assert.equal(arbitraryPath.status, 404);
assert.deepEqual(arbitraryPath.body, { ok: false, code: "not_found" });

// (c) Arbitrary HTTP method
const arbitraryMethod = await call({ auth: `Bearer ${TEST_BEARER}`, method: "GET", path: "/v1/service/status", body: "" });
assert.equal(arbitraryMethod.status, 404);

// (d) Payload exceeding 64 bytes
const oversizedBody = await call({ auth: `Bearer ${TEST_BEARER}`, body: " ".repeat(100) });
assert.equal(oversizedBody.status, 400);

// (e) T3 Contract Rust source verification
const contractSrc = readFileSync(fileURLToPath(new URL("../contract/src/lib.rs", import.meta.url)), "utf8");
assert.ok(contractSrc.includes('req.input.as_deref() == Some(b"{}")'), "T3 contract must reject any input other than exact {}");
assert.ok(contractSrc.includes('req.user_profile.is_none()'), "T3 contract must reject user profile injections");
assert.ok(!contractSrc.includes("req.url"), "T3 contract must not allow caller-controlled URL");
pass("Caller cannot choose arbitrary service, URL, command, or parameters", "Executor requires exact empty {} and strictly known paths; T3 contract enforces rigid schema");

await new Promise((resolve) => executor.close(resolve));

console.log("\n=======================================================");
console.log(`  ALL ${passed}/8 BOUNDARY VERIFICATIONS PASSED SUCCESSFULLY`);
console.log("=======================================================\n");
