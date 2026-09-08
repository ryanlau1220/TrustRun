import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";

console.log("\n=======================================================");
console.log("  TrustRun v1 — Real Runtime Sandbox Negative & Positive Proof");
console.log("=======================================================\n");

let passed = 0;
function pass(testName, detail) {
  passed++;
  console.log(`[PASS] Check ${passed}: ${testName}`);
  if (detail) console.log(`       → ${detail}`);
}

// -------------------------------------------------------------
// 1. GONKA_API_KEY absent from environment
// -------------------------------------------------------------
assert.equal(process.env.GONKA_API_KEY, undefined, "GONKA_API_KEY must not exist in sandbox environment");
pass("GONKA_API_KEY is absent from environment", "Sandbox environment is cleared (--clearenv)");

// -------------------------------------------------------------
// 2. T3N_API_KEY absent from environment
// -------------------------------------------------------------
assert.equal(process.env.T3N_API_KEY, undefined, "T3N_API_KEY must not exist in sandbox environment");
pass("T3N_API_KEY is absent from environment", "Host T3 key is strictly isolated to the host runtime");

// -------------------------------------------------------------
// 3. Executor bearer absent from environment
// -------------------------------------------------------------
assert.equal(process.env.TRUSTRUN_EXECUTOR_BEARER, undefined, "TRUSTRUN_EXECUTOR_BEARER must not exist in sandbox environment");
assert.equal(process.env.EXECUTOR_BEARER, undefined, "EXECUTOR_BEARER must not exist in sandbox environment");
pass("Executor bearer is absent from environment", "Bearer exists only inside Terminal 3 TEE and host executor");

// -------------------------------------------------------------
// 4. /etc/trustrun/gonka.env is inaccessible / unmounted
// -------------------------------------------------------------
assert.equal(existsSync("/etc/trustrun/gonka.env"), false, "/etc/trustrun/gonka.env must not exist in sandbox");
try {
  readFileSync("/etc/trustrun/gonka.env");
  assert.fail("Read /etc/trustrun/gonka.env should fail");
} catch (err) {
  assert.equal(err.code, "ENOENT", "Path must not be mounted into sandbox filesystem");
}
pass("/etc/trustrun/gonka.env is unmounted", "Secret file path does not exist inside sandbox filesystem");

// -------------------------------------------------------------
// 5. /var/lib/trustrun-executor is inaccessible / unmounted
// -------------------------------------------------------------
assert.equal(existsSync("/var/lib/trustrun-executor"), false, "/var/lib/trustrun-executor must not exist in sandbox");
try {
  readdirSync("/var/lib/trustrun-executor");
  assert.fail("Directory listing of /var/lib/trustrun-executor should fail");
} catch (err) {
  assert.equal(err.code, "ENOENT", "Executor state directory must not be mounted into sandbox");
}
pass("/var/lib/trustrun-executor is unmounted", "Durable SQLite state and bearer config are unmounted");

// -------------------------------------------------------------
// 6. Direct executor network connection fails
// -------------------------------------------------------------
let directNetworkBlocked = false;
try {
  execFileSync("curl", ["-k", "-m", "1", "https://127.0.0.1:8443"], { stdio: "pipe" });
} catch (err) {
  directNetworkBlocked = true;
}
assert.ok(directNetworkBlocked, "Direct connection to executor must fail");
pass("Direct network access to executor fails", "Sandbox network namespace is completely unshared (--unshare-all)");

// -------------------------------------------------------------
// 7. Direct host management commands fail
// -------------------------------------------------------------
let systemctlBlocked = false;
try {
  execFileSync("systemctl", ["is-active", "my-api.service"], { stdio: "pipe" });
} catch (err) {
  systemctlBlocked = true;
}
assert.ok(systemctlBlocked, "Direct systemctl execution must fail");
pass("Direct systemctl control fails", "Sandbox has no D-Bus socket or systemd control access");

// -------------------------------------------------------------
// Connect to TrustRun MCP over the session domain socket
// -------------------------------------------------------------
const socketPath = process.env.TRUSTRUN_SESSION_SOCKET;
assert.ok(socketPath, "TRUSTRUN_SESSION_SOCKET must be set in sandbox");

class McpClient {
  constructor(path) {
    this.path = path;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = createConnection(this.path);
      this.socket.on("error", reject);
      this.socket.on("connect", () => {
        let buffer = "";
        this.socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id && this.pending.has(msg.id)) {
                const { resolve: res, reject: rej } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
                else res(msg.result);
              }
            } catch (parseErr) {
              console.error("JSON parse error:", parseErr);
            }
          }
        });
        resolve();
      });
    });
  }

  async request(method, params = {}) {
    const reqId = this.id++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.socket.write(payload);
    });
  }

  close() {
    this.socket?.end();
  }
}

const client = new McpClient(socketPath);
await client.connect();

await client.request("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "runtime-verification", version: "1.0.0" },
});

// -------------------------------------------------------------
// 8. Arbitrary tools / commands are unavailable
// -------------------------------------------------------------
const toolsResult = await client.request("tools/list", {});
const toolNames = (toolsResult.tools || []).map((t) => t.name).sort();
assert.deepEqual(toolNames, ["service.restart", "service.status"], "Only service.status and service.restart exist");

const arbitraryCall = await client.request("tools/call", { name: "shell.exec", arguments: { command: "reboot" } });
assert.ok(arbitraryCall.isError === true, "Arbitrary tool call must return isError: true");
assert.ok(arbitraryCall.content?.[0]?.text?.includes("Tool shell.exec not found"), "Must return tool not found");

const unknownToolCall = await client.request("tools/call", { name: "service.reboot", arguments: {} });
assert.ok(unknownToolCall.isError === true, "Unknown capability call must return isError: true");
assert.ok(unknownToolCall.content?.[0]?.text?.includes("Tool service.reboot not found"), "Must return tool not found");
pass("Arbitrary tools and shell commands are rejected", "MCP exposes strictly service.status and service.restart");

// -------------------------------------------------------------
// 9. service.status succeeds via TrustRun / Terminal 3 TEE
// -------------------------------------------------------------
const statusCall = await client.request("tools/call", { name: "service.status", arguments: {} });
assert.ok(statusCall.content?.[0]?.text, "service.status should return content");
const statusData = JSON.parse(statusCall.content[0].text);
assert.equal(statusData.service, "my-api", "service must be my-api");
assert.ok(["running", "not_running"].includes(statusData.status), "status must be running or not_running");
pass("service.status succeeds via Terminal 3 TEE", `Returned sanitized payload: ${JSON.stringify(statusData)}`);

// -------------------------------------------------------------
// 10. service.restart succeeds or is denied by cooldown
// -------------------------------------------------------------
const restartCall = await client.request("tools/call", { name: "service.restart", arguments: {} });
const restartData = JSON.parse(restartCall.content[0].text);

if (restartData.ok === true) {
  assert.equal(restartData.service, "my-api");
  assert.equal(restartData.status, "restart_requested");
  pass("service.restart succeeds via Terminal 3 TEE", "Authorized restart dispatched to HTTPS executor");

  // Immediate second restart must be denied by cooldown
  const secondRestart = await client.request("tools/call", { name: "service.restart", arguments: {} });
  const secondData = JSON.parse(secondRestart.content[0].text);
  assert.equal(secondData.ok, false);
  assert.equal(secondData.code, "unavailable");
  pass("Immediate second restart is denied by cooldown", "Durable cooldown prevented rapid restart");
} else {
  // Already in cooldown from previous restart
  assert.equal(restartData.ok, false);
  assert.equal(restartData.code, "unavailable");
  pass("service.restart enforces durable cooldown", `Denied repeat restart with code '${restartData.code}'`);
}

client.close();

console.log("\n=======================================================");
console.log(`  ALL ${passed}/${passed} RUNTIME SANDBOX PROOFS PASSED SUCCESSFULLY`);
console.log("=======================================================\n");
