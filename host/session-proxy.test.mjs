import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = await mkdtemp(join(tmpdir(), "trustrun-session-proxy-"));
const socketPath = join(runtime, "session.sock");
let proxy;

async function waitForSocket() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(socketPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("session proxy did not start");
}

function initialize() {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    const timer = setTimeout(() => reject(new Error("MCP initialize timed out")), 3000);
    client.once("error", reject);
    client.once("data", (data) => {
      const response = JSON.parse(data);
      client.destroy();
      client.once("close", () => {
        clearTimeout(timer);
        resolve(response);
      });
    });
    client.once("connect", () => client.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    })}\n`));
  });
}

try {
  await copyFile(join(root, "host/session-proxy.mjs"), join(runtime, "session-proxy.mjs"));
  await copyFile(join(root, "mcp/server.mjs"), join(runtime, "mcp-server.mjs"));
  await symlink(join(root, "node_modules"), join(runtime, "node_modules"));
  proxy = spawn(process.execPath, [join(runtime, "session-proxy.mjs")], {
    env: { PATH: process.env.PATH, TRUSTRUN_SESSION_SOCKET: socketPath, T3N_API_KEY: "placeholder" },
    stdio: "ignore",
  });
  await waitForSocket();
  assert.equal((await initialize()).result?.serverInfo?.name, "trustrun");
  assert.equal((await initialize()).result?.serverInfo?.name, "trustrun");
} finally {
  proxy?.kill();
  await rm(runtime, { recursive: true, force: true });
}
