# TrustRun V1 — Live Verification Evidence

This document records the exact, verified technical evidence collected from running the TrustRun v1 proof on Terminal 3 testnet and local Linux infrastructure. No speculative or unverified claims are included.

---

## 1. Environment & Cryptographic Identity

* **Terminal 3 Environment:** `testnet`
* **SDK Version:** `@terminal3/t3n-sdk@5.2.0` (Node.js ESM)
* **Tenant Address:** `0x85ceb62f87bfcb3b5ba83a653913797399e204d3`
* **Tenant Identity:** Authenticated via Ethereum signature (`metamask_sign` with `createEthAuthInput`) returning tenant DID format `did:t3n:<tenant_id>`
* **Host Runtime:** Linux x86_64, systemd v255, Bubblewrap (`bwrap`) v0.9.0+

---

## 2. Terminal 3 TEE Contract Registration

* **Contract Tail:** `trustrun-v1`
* **Contract Canonical Identifier:** `z:<tenant_hash>:trustrun-v1`
* **Contract Compilation Target:** `wasm32-wasip2` via Rust `wit-bindgen` and `cargo build --release`
* **Verified Contract Version:** `0.1.5`
* **Registered Functions:**
  * `service-status`
  * `service-restart`
* **Secret Storage:**
  * Map Tail: `secrets` (`z:<tenant_hash>:secrets`)
  * Visibility: `private`
  * Access Control: `writers = [contract_id]`, `readers = [contract_id]`
  * Secret Entry: `executor_bearer` (high-entropy, 48-byte random token)
* **Delegation & Egress Authorization:**
  * Member delegation granted on contract `trustrun-v1` for functions `service-status` and `service-restart`
  * `allowed_hosts`: Strictly set to the executor HTTPS hostname (e.g., Cloudflare tunnel endpoint)
  * Outbound HTTP to any other host or IP is rejected by the TEE host

---

## 3. Live Capability Proof Cases

The test script `scripts/t3-live-proof.mjs` was executed against the live TEE testnet and the local HTTPS executor:

### A. `service.status`
* **Input:** `{}` (empty JSON object)
* **TEE Outbound:** `POST https://<executor_origin>/v1/service/status` with `Authorization: Bearer <executor_bearer>`
* **Host Verification:** Executor ran `/usr/bin/systemctl is-active --quiet my-api.service`
* **Observed Response:**
  ```json
  {
    "ok": true,
    "service": "my-api",
    "status": "running"
  }
  ```
  *(When service stopped manually: returns `"status": "not_running"`)*

### B. `service.restart`
* **Input:** `{}` (empty JSON object)
* **TEE Outbound:** `POST https://<executor_origin>/v1/service/restart` with `Authorization: Bearer <executor_bearer>`
* **Host Verification:** Executor reserved single-flight in SQLite WAL and executed `/usr/bin/sudo -n /usr/local/libexec/trustrun-restart-my-api`
* **Systemd Journal Confirmation:**
  ```text
  sudo: trustrun-executor : PWD=/ ; USER=root ; COMMAND=/usr/local/libexec/trustrun-restart-my-api
  systemd[1]: Stopping my-api.service - TrustRun v1 test service...
  systemd[1]: Stopped my-api.service - TrustRun v1 test service.
  systemd[1]: Started my-api.service - TrustRun v1 test service.
  ```
* **Observed Response:**
  ```json
  {
    "ok": true,
    "service": "my-api",
    "status": "restart_requested"
  }
  ```

---

## 4. Negative Boundary Verifications

### A. Direct Executor Access from Outside / Sandbox
* Direct HTTPS call to executor without bearer:
  ```bash
  curl -k -X POST https://127.0.0.1:8443/v1/service/status
  ```
  **Result:** HTTP `401 Unauthorized` (`{"ok": false, "code": "unauthorized"}`).
* Direct call from inside sandbox:
  `bwrap` runs with `--unshare-all` (unsharing network namespace). There are no network interfaces except an unconfigured loopback. All network sockets fail with `ENETUNREACH` / `Network is unreachable`. The executor port 8443 cannot be reached.

### B. Credential Absence in Sandbox
* `GONKA_API_KEY`: Stored in `/etc/trustrun/gonka.env` with permissions `0600 root:root`. Not mounted into the sandbox filesystem.
* `T3N_API_KEY`: Kept in host memory for `host/run-session`; stripped by `bwrap --clearenv`.
* Executor Bearer: Stored only in T3 TEE secret storage and `/var/lib/trustrun-executor/`; not mounted in sandbox.
* Workspace `.env`: Sandbox startup script `sandbox/run` explicitly inspects `$workspace/.env` and aborts if present.
* Git metadata: Mounted as an empty `tmpfs` over `/workspace/.git` to prevent repo secret scraping.

### C. Restart Cooldown Rejection
* Durably recorded in `/var/lib/trustrun-executor/state.db` (`cooldown_until_ms = now + 600000`).
* Replay test immediately following a successful restart:
  **Result:** HTTP `409 Conflict` (`{"ok": false, "code": "cooldown"}`).

### D. Input Tampering & Unknown Capability Denial
* Call with arbitrary parameters (e.g., `{"service": "other"}` or `{"service": "my-api"}`):
  **Result:** T3 contract function `no_args` validates `req.input == b"{}"` and rejects with `"invalid input"`.
* Call to unauthorized or unexposed capability (e.g., `service-restart-other` or `service-logs`):
  **Result:** Rejected at TEE function dispatch level.

### E. Fixed Sanitized Output Schema
* Contract and executor schemas strictly enforce:
  ```json
  {
    "ok": true,
    "service": "my-api",
    "status": "running" | "not_running" | "restart_requested"
  }
  ```
* Command stdout/stderr, shell environment variables, file paths, and systemd logs are discarded.

---

## 5. Known Limitations & Unverified Claims

1. **Single-Service Scope:** V1 is explicitly bounded to `my-api.service`. It does not manage arbitrary or dynamic services.
2. **Tenant Self-Delegation:** The current testnet contract registers delegation to the tenant DID itself (`grantee: did.value`). A dedicated runtime keypair / sub-identity delegation is defined as the next hardening phase (see [docs/SECURITY.md](SECURITY.md)).
3. **No Attestation Quote Verification:** TrustRun relies on Terminal 3's testnet enclave guarantees. Hardware quote verification (e.g., SGX/TDX quote validation by the executor) is not implemented in v1.
4. **Host OS Trust Dependency:** Host kernel isolation (`bwrap`, namespaces, cgroups, sudoers) is trusted. Kernel zero-days or root exploits on the host are out of scope.
