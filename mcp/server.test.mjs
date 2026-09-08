import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.mjs";

const directory = await mkdtemp(join(tmpdir(), "trustrun-mcp-"));
const path = join(directory, "session.sock");
let mcp;
const proxy = createServer(async (socket) => {
  mcp = createMcpServer();
  socket.once("close", () => void mcp.close());
  await mcp.connect(new StdioServerTransport(socket, socket));
});
await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(path, resolve);
});
const client = createConnection(path);
const response = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("MCP initialize timed out")), 3000);
  client.once("data", (data) => {
    clearTimeout(timer);
    resolve(JSON.parse(data));
  });
  client.once("error", reject);
  client.once("connect", () => client.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  })}\n`));
});
assert.equal(response.result?.serverInfo?.name, "trustrun");
const tools = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("MCP tools/list timed out")), 3000);
  client.once("data", (data) => {
    clearTimeout(timer);
    resolve(JSON.parse(data).result?.tools?.map((tool) => tool.name).sort());
  });
  client.once("error", reject);
  client.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
});
assert.deepEqual(tools, ["service.restart", "service.status"]);
client.end();
await new Promise((resolve) => proxy.close(resolve));
await rm(directory, { recursive: true, force: true });
