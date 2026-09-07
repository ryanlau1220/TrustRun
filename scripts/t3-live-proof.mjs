import assert from "node:assert/strict";
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

const apiKey = process.env.T3N_API_KEY;
if (!apiKey) throw new Error("T3N_API_KEY is required");

let stage = "initialization";
try {
  setEnvironment("testnet");
  const address = eth_get_address(apiKey);
  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent: await loadWasmComponent(),
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });
  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  const scriptName = `z:${did.value.slice("did:t3n:".length)}:trustrun-v1`;
  const scriptVersion = await getContractVersion(getNodeUrl(), scriptName);
  const invoke = (functionName, input) => t3n.executeAndDecode({ script_name: scriptName, script_version: scriptVersion, function_name: functionName, pii_did: did.value, input });

  stage = "status";
  const status = await invoke("service-status", {});
  assert.equal(status.ok, true);
  assert.equal(status.service, "my-api");
  assert.ok(["running", "not_running"].includes(status.status));
  stage = "unknown input denial";
  await assert.rejects(invoke("service-restart", { service: "other" }));
  stage = "unknown capability denial";
  await assert.rejects(invoke("service-restart-other", {}));
  stage = "restart";
  const restart = await invoke("service-restart", {});
  assert.deepEqual(restart, { ok: true, service: "my-api", status: "restart_requested" });
  stage = "cooldown denial";
  await assert.rejects(invoke("service-restart", {}));
  console.log("Live T3 proof passed.");
} catch (error) {
  const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "unknown error";
  console.error(`Live T3 proof failed at ${stage}: ${message}`);
  process.exitCode = 1;
}
