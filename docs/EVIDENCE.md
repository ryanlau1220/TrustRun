# TrustRun V1 — Verification Evidence

This document records the exact, verified technical evidence collected from running the TrustRun v1 proof across three distinct layers:
1. **Live Terminal 3 TEE Proof** (live testnet TEE contract execution)
2. **Runtime Sandbox Proof** (live process and filesystem isolation inside Bubblewrap)
3. **Structural Automated Regression Checks** (source code and configuration regression assertions)

---

## 1. Live Terminal 3 TEE Proof

Executed live against the Terminal 3 testnet and local HTTPS executor via `scripts/t3-live-proof.mjs` and `host/live-proof`:

### Environment & Identity
* **Terminal 3 Environment:** `testnet`
* **SDK Version:** `@terminal3/t3n-sdk@5.2.0` (Node.js ESM)
* **Tenant Address:** `0x85ceb62f87bfcb3b5ba83a653913797399e204d3`
* **Tenant Identity:** Authenticated via Ethereum signature (`metamask_sign` with `createEthAuthInput`) returning tenant DID `did:t3n:<tenant_id>`
* **Host Runtime:** Linux x86_64, systemd v255, Bubblewrap (`bwrap`) v0.9.0+

### TEE Contract Registration
* **Contract Tail:** `trustrun-v1`
* **Contract Canonical Identifier:** `z:<tenant_hash>:trustrun-v1`
* **Contract Compilation Target:** `wasm32-wasip2` via Rust `wit-bindgen` and `cargo build --release`
* **Verified Contract Versions:** `0.1.6` (and `0.1.5`)
* **Registered Functions:** `service-status`, `service-restart`
* **Secret Storage:**
  * Map Tail: `secrets` (`z:<tenant_hash>:secrets`), `visibility: private`
  * Access Control: `writers = [contract_id]`, `readers = [contract_id]`
  * Secret Entry: `executor_bearer` (high-entropy, 48-byte token)
* **Delegation & Egress Authorization:**
  * Tenant self-delegation on contract `trustrun-v1` for functions `service-status` and `service-restart`
  * `allowed_hosts`: Strictly set to the executor HTTPS hostname
  * Outbound HTTP to any other host or IP is rejected by the TEE host

### Live Capability Execution
* **`service.status`**:
  * Input: `{}` (empty JSON object)
  * Outbound: `POST https://<executor_origin>/v1/service/status` with `Authorization: Bearer <executor_bearer>`
  * Executor: Invoked `/usr/bin/systemctl is-active --quiet my-api.service`
  * Observed Output:
    ```json
    { "ok": true, "service": "my-api", "status": "running" }
    ```
* **`service.restart`**:
  * Input: `{}` (empty JSON object)
  * Outbound: `POST https://<executor_origin>/v1/service/restart` with `Authorization: Bearer <executor_bearer>`
  * Executor: Reserved single-flight state in SQLite WAL and executed `/usr/bin/sudo -n /usr/local/libexec/trustrun-restart-my-api`
  * Observed Output:
    ```json
    { "ok": true, "service": "my-api", "status": "restart_requested" }
    ```

---

## 2. Runtime Sandbox Proof

Executed inside the live, running Bubblewrap (`bwrap`) container using `pnpm sandbox:proof` (`/usr/local/lib/trustrun-runtime/run-session -- node scripts/verify-sandbox-runtime.mjs`). This directly verifies the live running process inside the sandbox namespace:

| Check | Runtime Assertion | Result |
| :--- | :--- | :--- |
| **`GONKA_API_KEY` Absent** | `process.env.GONKA_API_KEY === undefined` | **PASS** (Cleared via `bwrap --clearenv`) |
| **`T3N_API_KEY` Absent** | `process.env.T3N_API_KEY === undefined` | **PASS** (Restricted to host runtime only) |
| **Executor Bearer Absent** | `process.env.TRUSTRUN_EXECUTOR_BEARER === undefined` | **PASS** (Confined to T3 TEE secrets and executor) |
| **`/etc/trustrun/gonka.env` Unmounted** | `fs.readFileSync('/etc/trustrun/gonka.env')` throws `ENOENT` | **PASS** (Directory/file is not mounted) |
| **`/var/lib/trustrun-executor` Unmounted** | `fs.readdirSync('/var/lib/trustrun-executor')` throws `ENOENT` | **PASS** (Directory/file is not mounted) |
| **Direct Executor Network Blocked** | `curl -k https://127.0.0.1:8443` fails | **PASS** (Namespace unshared via `--unshare-all`) |
| **Direct `systemctl` Blocked** | `systemctl is-active my-api.service` fails | **PASS** (No D-Bus socket or host systemd access) |
| **Arbitrary Tools Blocked** | MCP `tools/call` for `shell.exec` returns `isError: true` | **PASS** (Strictly `service.status` and `service.restart`) |
| **Arbitrary Parameters Blocked** | MCP `service.restart` with unexpected args returns `isError: true` | **PASS** (Strict zero-argument validation) |
| **`service.status` via T3 TEE** | MCP `service.status` returns `{ ok: true, service: "my-api", status: ... }` | **PASS** (Delegated through domain socket to T3 TEE) |
| **`service.restart` Cooldown Enforcement** | Immediate second restart returns `{ ok: false, code: "unavailable" }` | **PASS** (Durable 10-minute cooldown enforced) |

---

## 3. Structural Automated Regression Checks

Executed via `pnpm test` and `pnpm test:boundaries` (`scripts/verify-demo-boundaries.mjs`). 

> [!NOTE]
> These structural source and configuration checks serve as continuous integration regression tests. They ensure scripts, file modes, and boundary invariants do not regress during development, complementing the live runtime proofs above.

* **File Permission Guarantees:** Asserts `/etc/trustrun/gonka.env` has file mode `0600` (root-only).
* **Sandbox Launch Script Static Invariants:** Inspects `sandbox/run` to ensure `--clearenv`, `--unshare-all`, and no mounts for `/etc/trustrun` or `/var/lib/trustrun-executor`.
* **Local Mock Executor Boundaries:** Verifies that direct unauthorized requests return `401 Unauthorized`, unhandled routes return `404 Not Found`, non-JSON bodies return `400 Bad Request`, and unexpected fields in JSON payloads are rejected.
* **Durable SQLite State Guard:** Verifies single-flight lock acquisition, serialization, and cooldown timestamp enforcement.

---

## 4. Known Limitations & Explicit Non-Claims

1. **Terminal 3 TEE-Backed Execution (No Hardware Attestation Verification in v1):** TrustRun relies on Terminal 3's testnet enclave guarantees. Independent hardware attestation quote verification (e.g., verifying SGX/TDX quote hashes on the executor) is not implemented in v1.
2. **Current Identity Model:** Uses tenant self-delegation (`grantee: did:t3n:...`) for demo stability. A dedicated runtime DID sub-identity delegation is documented as the next hardening phase.
3. **Single Bearer Token:** V1 uses a single executor bearer token shared between Terminal 3 private KV storage and the executor configuration. Active/previous bearer rotation is documented for future hardening.
4. **Single-Service Scope:** V1 strictly controls `my-api.service`. No arbitrary service targets or dynamic parameters are supported.
5. **Host OS Trust Anchor:** The host Linux kernel and Bubblewrap sandbox enforcement are trusted. Host kernel-level zero-days are out of scope.
