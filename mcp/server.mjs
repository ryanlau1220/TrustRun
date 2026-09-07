import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, service: "my-api", status: value.status }) }] };
}

export function createMcpServer() {
  let sessionPromise;
  const session = () => {
    sessionPromise ??= connect();
    return sessionPromise;
  };
  const server = new McpServer({ name: "trustrun", version: "0.1.0" });
  const invoke = async (functionName, allowed) => {
    try {
      const active = await session();
      return result(await active.t3n.executeAndDecode({
        script_name: active.scriptName,
        script_version: active.scriptVersion,
        function_name: functionName,
        pii_did: active.did,
        input: {},
      }), allowed);
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: "unavailable" }) }], isError: true };
    }
  };
  server.registerTool("service.status", { description: "Return the sanitized status of my-api.service.", inputSchema: {} }, () => invoke("service-status", ["running", "not_running"]));
  server.registerTool("service.restart", { description: "Request a restart of my-api.service.", inputSchema: {} }, () => invoke("service-restart", ["restart_requested"]));
  return server;
}

async function main() {
  await createMcpServer().connect(new StdioServerTransport());
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(() => process.exit(1));
