# TrustRun

> **TrustRun gives AI agents privileged capabilities without giving them privileged credentials.**

TrustRun is a safe execution environment and capability gateway for AI agents. Rather than providing an autonomous agent with unrestricted SSH keys, root passwords, cloud credentials, or Docker sockets, TrustRun isolates the agent in a tightly constrained sandbox and mediates privileged operations through a cryptographically anchored capability path.

---

## The V1 Live Proof

**The Proof:**
> An untrusted Codex agent can operate normally inside an isolated TrustRun sandbox, receive model inference through a credential-isolating Gonka gateway, and perform exactly two privileged VPS actions only through a Terminal 3-backed trusted execution path.

An agent with arbitrary code execution inside an isolated Linux sandbox can invoke exactly two no-argument capabilities for exactly one fixed VPS service:

- `service.status`
- `service.restart`

The sandbox contains **no privileged infrastructure credentials**, **no provider API keys**, and **no network path to the management plane**.

```text
┌────────────────────────────────────────────────────────────┐
│                    UNTRUSTED SANDBOX                       │
│  Codex Agent  ──(stdio)──>  mcp-bridge.mjs                 │
│      │                                                     │
│  (HTTP / Unix socket)                                      │
│      │                                                     │
│      ▼                                                     │
│  model-bridge.mjs                                          │
└──────┼─────────────────────────────┼───────────────────────┘
       │ (model.sock)                │ (session.sock)
       ▼                             ▼
┌────────────────────────────────────────────────────────────┐
│                    TRUSTED HOST ENVIRONMENT                │
│  host/model-gateway.mjs          host/session-proxy.mjs    │
│  - Holds GONKA_API_KEY           - Mounts TrustRun MCP     │
│  - Proxies to GonkaRouter        - Holds T3N_API_KEY       │
│  - Upstream: DeepSeek-V4                   │               │
│                                            ▼               │
│                                  Terminal 3 TEE Contract   │
│                                  (Rust / WASM on Testnet)  │
│                                  - Validates caller & DID  │
│                                  - Holds executor_bearer   │
│                                  - Allowlisted egress only │
│                                            │               │
│                                     (HTTPS POST + Bearer)  │
│                                            ▼               │
│                                  TrustRun HTTPS Executor   │
│                                  - Enforces 10m cooldown   │
│                                  - Single-flight via SQLite│
│                                  - Unprivileged user       │
│                                            │               │
│                                  (sudo -n helper)          │
│                                            ▼               │
│                                  systemd my-api.service    │
└────────────────────────────────────────────────────────────┘
```

---

## Dual-Gateway Architecture

TrustRun cleanly separates inference traffic from capability execution while keeping all sensitive credentials outside the sandbox:

### 1. Inference Gateway (Host Model Gateway)
* **Agent interface:** Codex CLI inside the sandbox sends OpenAI Responses API requests to `http://127.0.0.1:8787/v1` via an internal Unix domain socket bridge (`/run/trustrun/model.sock`).
* **Credential isolation:** `GONKA_API_KEY` resides strictly in `/etc/trustrun/gonka.env` (permissions `0600`, owned by `root`). The sandbox has no filesystem mount or environment variable containing this key.
* **Upstream routing:** The host model gateway translates streaming events and forwards requests to GonkaRouter (`deepseek-ai/DeepSeek-V4-Flash-0731`) over verified HTTPS.

### 2. Capability Gateway (TrustRun MCP + Terminal 3)
* **Agent interface:** Model Context Protocol (MCP) server over `/run/trustrun/session.sock`, exposing only `service.status` and `service.restart`.
* **Hardware-enforced authority:** Invocations pass through a Terminal 3 (T3) TEE smart contract compiled to `wasm32-wasip2`. The contract validates that inputs are empty JSON objects `{}` and fetches the executor bearer token from private T3 tenant storage.
* **Egress allowlisting:** T3 restricts outbound HTTP calls strictly to the registered executor hostname.
* **Privileged executor:** The executor runs under an unprivileged user (`trustrun-executor`), enforces a durable 10-minute cooldown and single-flight execution using SQLite in WAL mode, and triggers a parameterless, root-owned restart helper (`/usr/local/libexec/trustrun-restart-my-api`).
* **Sanitized outputs:** Only `{ ok: true, service: "my-api", status: "running" | "not_running" | "restart_requested" }` is returned to the agent. No stdout, stderr, logs, or system paths ever cross the boundary.

---

## Security Boundary & Non-Negotiables

| Resource | Inside Sandbox? | Defense / Boundary |
| :--- | :--- | :--- |
| `T3N_API_KEY` | ❌ **ABSENT** | Kept in host session environment only |
| `GONKA_API_KEY` | ❌ **ABSENT** | Root-owned file (`0600`) outside sandbox |
| Executor Bearer Token | ❌ **ABSENT** | Stored in T3 private KV store and host executor config |
| SSH Keys / Host Credentials | ❌ **ABSENT** | Cleared environment (`bwrap --clearenv`), no home mounts |
| Docker Socket | ❌ **ABSENT** | Not mounted; `/var/run` is unmapped |
| Direct Network / Management Port | ❌ **BLOCKED** | `--unshare-all` network namespace; port 8443 unreachable |
| Workspace `.env` / Secrets | ❌ **BLOCKED** | Refuses execution if `.env` exists; tmpfs over `.git` |
| Process Persistence | ❌ **TERMINATED**| Sandbox runs in transient systemd cgroup; killed on session exit |

For the complete security model and threat analysis, see [docs/SECURITY.md](docs/SECURITY.md).  
For the verified test evidence from live testnet runs, see [docs/EVIDENCE.md](docs/EVIDENCE.md).

---

## Live Demo & Verification

### Running the Demo Presenter
Launch the real-time proof console:
```bash
pnpm demo
# Open http://127.0.0.1:4173 in your browser
```

### Running the Boundary Verification Test Suite
Verify that all 8 negative and positive boundary constraints pass:
```bash
pnpm test:boundaries
```

### Running the Full Component Suite
```bash
pnpm executor:test        # Cooldown & concurrency enforcement
pnpm mcp:test             # MCP tool schemas and event tracing
pnpm codex-config:test    # Codex sandbox configuration
pnpm session-proxy:test   # Session socket lifecycle
pnpm model-gateway:test   # Inference translation and streaming
pnpm t3:publish:test      # Contract registration guards
```

---

## Architecture References

- [HANDOFF.md](HANDOFF.md): Full historical engineering record and architectural rationale.
- [AGENTS.md](AGENTS.md): Strict security rules and scope boundaries for v1.
- [docs/SECURITY.md](docs/SECURITY.md): Threat model, security boundaries, and defense-in-depth analysis.
- [docs/EVIDENCE.md](docs/EVIDENCE.md): Concrete, verified proof evidence from Terminal 3 testnet.
