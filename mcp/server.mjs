import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CONTRACT_TAIL = "trustrun-v1";

async function connect() {
  const {
    T3nClient,
    createEthAuthInput,
    eth_get_address,
    fetchTrustedManifest,
    getContractVersion,
    getNodeUrl,
    loadWasmComponent,
    metamask_sign,
    setEnvironment,
  } = await import("@terminal3/t3n-sdk");
  const apiKey = process.env.T3N_API_KEY;
  if (!apiKey) throw new Error("T3N_API_KEY is required");
  setEnvironment("testnet");
  const address = eth_get_address(apiKey);
  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent: await loadWasmComponent(),
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });
  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  const scriptName = `z:${did.value.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;
  return { t3n, scriptName, scriptVersion: await getContractVersion(getNodeUrl(), scriptName), did: did.value };
}

function result(value, allowed) {
  if (!value || value.ok !== true || value.service !== "my-api" || !allowed.includes(value.status)) throw new Error("invalid contract response");
  return { ok: true, service: "my-api", status: value.status };
}

export async function recordDemoEvent(capability, value) {
  const path = process.env.TRUSTRUN_DEMO_TRACE;
  if (!path) return;
  if (!(["service.status", "service.restart"].includes(capability))) return;
  if (!value || typeof value !== "object" || value.ok !== true || value.service !== "my-api" || typeof value.status !== "string") return;
  await writeFile(path, `${JSON.stringify({ at: Date.now(), capability, result: value })}\n`, { mode: 0o600 }).catch(() => {});
}

function response(value, error = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(error && { isError: true }) };
}

export function createMcpServer() {
  let sessionPromise;
  const session = () => {
    sessionPromise ??= connect();
    return sessionPromise;
  };
  const server = new McpServer({ name: "trustrun", version: "0.1.0" });
  const invoke = async (capability, functionName, allowed) => {
    let value;
    try {
      const active = await session();
      value = result(await active.t3n.executeAndDecode({
        script_name: active.scriptName,
        script_version: active.scriptVersion,
        function_name: functionName,
        pii_did: active.did,
        input: {},
      }), allowed);
    } catch {
      return response({ ok: false, code: "unavailable" }, true);
    }
    await recordDemoEvent(capability, value);
    return response(value);
  };
  server.registerTool("service.status", { description: "Return the sanitized status of my-api.service.", inputSchema: {} }, () => invoke("service.status", "service-status", ["running", "not_running"]));
  server.registerTool("service.restart", { description: "Request a restart of my-api.service.", inputSchema: {} }, () => invoke("service.restart", "service-restart", ["restart_requested"]));
  return server;
}

async function main() {
  await createMcpServer().connect(new StdioServerTransport());
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(() => process.exit(1));
