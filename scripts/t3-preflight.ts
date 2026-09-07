import {
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";

const apiKey = process.env.T3N_API_KEY;
if (!apiKey) throw new Error("T3N_API_KEY must be exported in this shell.");

setEnvironment("testnet");
const wasmComponent = await loadWasmComponent();
const address = eth_get_address(apiKey);
const t3n = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent,
  handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
});

await t3n.handshake();
const did = await t3n.authenticate(createEthAuthInput(address));
console.log("Connected as:", did.value);
