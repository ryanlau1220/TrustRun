import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  getContractVersion,
  getNodeUrl,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";

const CONTRACT_TAIL = "trustrun-v1";

async function connect() {
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

async function main() {
  const session = await connect();
  const server = new McpServer({ name: "trustrun", version: "0.1.0" });
  const invoke = async (functionName, allowed) => {
    try {
      return result(await session.t3n.executeAndDecode({
        script_name: session.scriptName,
        script_version: session.scriptVersion,
        function_name: functionName,
        pii_did: session.did,
        input: {},
      }), allowed);
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, code: "unavailable" }) }], isError: true };
    }
  };
  server.registerTool("service.status", { description: "Return the sanitized status of my-api.service.", inputSchema: {} }, () => invoke("service-status", ["running", "not_running"]));
  server.registerTool("service.restart", { description: "Request a restart of my-api.service.", inputSchema: {} }, () => invoke("service-restart", ["restart_requested"]));
  await server.connect(new StdioServerTransport());
}

main().catch(() => process.exit(1));
