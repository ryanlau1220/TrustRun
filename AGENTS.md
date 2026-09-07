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
