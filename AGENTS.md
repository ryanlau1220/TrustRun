# TrustRun implementation guide

## Current scope

Build only the v1 proof: one Linux sandbox, one MCP server, one Terminal 3 contract, one HTTPS executor, one service (`my-api.service`), and two no-argument capabilities: `service.status` and `service.restart`.

Do not add approval flows, generic policies, targets, service IDs, shell/SSH/Docker access, logs, arbitrary parameters, multi-agent support, or observability integrations until this proof passes.

## Security rules

- Treat all sandbox processes and workspace content as untrusted.
- Keep policy, executor configuration, T3 credentials, and the session socket outside the sandbox.
- T3 exposes only fixed `status()` and `restart()` functions. No caller-controlled URL, headers, body, target, or operation.
- The executor accepts only authenticated HTTPS requests with a fixed JSON schema and maps them to fixed operations. Reject unknown fields and never log authentication headers.
- The executor runs unprivileged. Restarting uses a root-owned helper with no arguments that restarts only `my-api.service`.
- Persist restart cooldown and single-flight state. If its store is unavailable, deny the restart; never automatically retry an unknown write outcome.
- Return fixed sanitized schemas only; no raw command output, environment, logs, or paths.

## Required proof cases

- T3-authenticated `status` and `restart` succeed.
- Direct executor, SSH, and other management access from the sandbox fail.
- The agent cannot obtain the executor credential or alter trusted configuration.
- Restarting another service, using unknown inputs, or restarting during cooldown fails.
- Session exit prevents new requests and kills the sandbox cgroup; an already-dispatched bounded operation may finish.

## Terminal 3 ADK prerequisites

- Use the official TypeScript/JavaScript SDK from a plain Node ESM process; do not introduce a bundler for the proof.
- Keep `T3N_API_KEY` in the trusted host environment only. Never write it to the workspace, commit it, or make it available to the sandbox.
- Run `pnpm t3:preflight` successfully against testnet before creating the contract. Its returned tenant DID is opaque: use the authenticated value, never derive or hardcode it.
- Keep the TEE contract in a separate Rust crate compiled for `wasm32-wasip2`.
- T3 outbound HTTP permission comes from the caller's explicit grant. Grant only the fixed executor hostname before invocation; contracts do not self-authorize egress.
