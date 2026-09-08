import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  TenantClient,
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  getNodeUrl,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";

const CONTRACT_TAIL = "trustrun-v1";
const CONTRACT_VERSION = "0.1.4";
const SECRET_MAP = "secrets";
const SECRET_KEY = "executor_bearer";

export function executorOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("TRUSTRUN_EXECUTOR_ORIGIN must be a bare HTTPS origin");
  return url.origin;
}

export function isMapAlreadyExists(error) {
  return error instanceof Error && /\bmap already exists\b/i.test(error.message);
}

export function isContractVersionAlreadyRegistered(error) {
  return error instanceof Error && /contract version invalid: version .+ is not higher than current version/i.test(error.message);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const apiKey = required("T3N_API_KEY");
  const origin = executorOrigin(required("TRUSTRUN_EXECUTOR_ORIGIN"));
  const bearer = required("TRUSTRUN_EXECUTOR_BEARER");
  if (Buffer.byteLength(bearer) < 32) throw new Error("TRUSTRUN_EXECUTOR_BEARER must contain at least 32 bytes");

  execFileSync("cargo", ["build", "--target", "wasm32-wasip2", "--release"], { cwd: fileURLToPath(new URL("../contract/", import.meta.url)), env: { ...process.env, TRUSTRUN_EXECUTOR_ORIGIN: origin }, stdio: "inherit" });
  setEnvironment("testnet");
  const address = eth_get_address(apiKey);
  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent: await loadWasmComponent(),
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  });
  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid: did.value });
  await tenant.tenant.me();
  const registration = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: await readFile(fileURLToPath(new URL("../contract/target/wasm32-wasip2/release/trustrun_contract.wasm", import.meta.url))),
  });
  const acl = { only: [registration.contract_id] };
  try {
    await tenant.maps.create({ tail: SECRET_MAP, visibility: "private", writers: acl, readers: acl });
  } catch (error) {
    if (!isMapAlreadyExists(error)) throw error;
  }
  await tenant.maps.update(SECRET_MAP, { writers: acl, readers: acl });
  await tenant.executeControl("map-entry-set", { map_name: tenant.canonicalName(SECRET_MAP), key: SECRET_KEY, value: bearer });
  await t3n.updateMemberDelegation({
    grantee: did.value,
    contract_id: registration.name,
    version_req: CONTRACT_VERSION,
    functions: ["service-status", "service-restart"],
    scopes: [],
    allowed_hosts: [new URL(origin).hostname],
  });
  console.log("TrustRun contract published and self-granted.");
}

if (import.meta.main) {
  main().catch((error) => {
    if (isContractVersionAlreadyRegistered(error)) {
      console.error(`TrustRun publish failed: contract ${CONTRACT_VERSION} is immutable. Reuse its fixed HTTPS origin or publish a higher contract version for a new origin.`);
      process.exitCode = 1;
      return;
    }
    const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "unknown error";
    console.error(`TrustRun publish failed: ${message}`);
    process.exitCode = 1;
  });
}
