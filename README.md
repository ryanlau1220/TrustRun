# TrustRun

TrustRun is a trusted execution layer for AI agents. It gives an agent fixed, policy-controlled capabilities instead of privileged infrastructure credentials.

## Status

V1 proof is implemented and live-verified on Terminal 3 testnet. It is not a production-ready security product.

## V1 proof

An agent with arbitrary code execution inside an isolated sandbox can call exactly two capabilities for exactly one VPS service:

- `service.status`
- `service.restart`

The agent cannot obtain the executor credential, directly authenticate to the management executor, choose arbitrary commands, or restart another service.

```text
Agent sandbox → TrustRun MCP → T3 status()/restart()
              → authenticated HTTPS executor → my-api.service
```

The executor exposes only fixed handlers for `my-api.service`; its restart path uses a root-owned, no-argument helper. The T3 contract owns the fixed destination and protected executor credential. No raw command output crosses back to the agent.

## Security boundary

TrustRun v1 protects the privileged management plane: systemd control, SSH, Docker, admin APIs, metadata services, private-network services, and their credentials. It does not prevent an agent from interacting with a normal public application endpoint or attacking that public surface.

The host OS, TrustRun runtime, executor, policy/configuration, and Terminal 3 path are trusted. The agent, prompts, generated code, workspace, and every process in the sandbox are untrusted. Host compromise and sandbox escape are outside the v1 threat model.

## Build gate

Before implementing the broader runtime, prove that Terminal 3 can make a fixed, allowlisted HTTPS call to the executor using an authentication credential unavailable to the agent. If client-certificate mTLS is unsupported, a T3-held high-entropy bearer over validated TLS is acceptable for the demo.

See [HANDOFF.md](HANDOFF.md) for the complete design record and [AGENTS.md](AGENTS.md) for implementation constraints.

## Development prerequisite

Terminal 3 ADK is a TypeScript/JavaScript client SDK with Rust-to-WASM TEE contracts; it is not an agent framework. After claiming a testnet key and credits, keep the key out of the repository and run the trusted-host preflight with `T3N_API_KEY='…' pnpm t3:preflight`. Do not run this from the agent sandbox.
