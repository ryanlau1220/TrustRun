# TrustRun — Project Handoff

## 1. Project Summary

**TrustRun** is a safe execution environment and trusted capability gateway for AI agents.

The core idea is simple:

> AI agents should not need unrestricted SSH, root, cloud, database, or production credentials in order to perform useful privileged actions.

Instead of trusting the agent to follow instructions, TrustRun constrains the environment in which the agent runs and exposes privileged operations only through narrowly scoped, policy-controlled capabilities.

TrustRun should work with existing agents such as:

* Claude Code
* Codex
* Hermes
* OpenClaw
* other MCP-compatible agents
* custom agents

TrustRun is **not another AI agent framework**.

It is an **agent-agnostic trusted execution layer**.

---

# 2. Problem

AI coding and operations agents are becoming increasingly capable.

Users can already give agents access to:

```text
shell
filesystem
SSH
Docker
databases
cloud APIs
deployment systems
production infrastructure
```

The security problem is that an autonomous agent may also receive:

```text
SSH_PRIVATE_KEY
ROOT_PASSWORD
DATABASE_ADMIN_PASSWORD
CLOUD_API_KEY
PRODUCTION_TOKEN
```

Once the credential is available inside the same environment as the agent, prompts and rules cannot provide a reliable security boundary.

Examples such as:

```text
AGENTS.md
CLAUDE.md
Skills
system prompts
tool descriptions
```

help agents behave correctly, but they do **not enforce security**.

The agent may:

* misunderstand instructions
* forget instructions
* select the wrong tool
* be affected by prompt injection
* execute an unintended command
* use an alternative execution path

Therefore:

> Security must not depend on the AI deciding to behave correctly.

---

# 3. Initial Idea and Evolution

Understanding the previous design decisions is important.

## Stage 1 — SRE Agent

The original idea was an autonomous VPS/SRE agent.

Architecture:

```text
Observability
    ↓
AI Agent
    ↓
Execution
```

Example:

```text
Prometheus alert
    ↓
Agent investigates logs and metrics
    ↓
Agent determines nginx failed
    ↓
Agent restarts nginx
    ↓
Agent verifies recovery
```

The target users were initially developers or students managing Linux VPS infrastructure without strong DevOps/SRE experience.

---

## Stage 2 — Observability + Agent + Trusted Execution

The architecture evolved into three layers:

```text
1. Observability
   Metrics
   Logs
   Alerts

2. Intelligence
   Investigate
   Diagnose
   Decide
   Verify

3. Execution
   Authorization
   Policy
   Credential protection
   Trusted execution
```

However, the first two layers already have mature ecosystems.

Observability can use:

* Prometheus
* Grafana
* Loki
* OpenTelemetry
* Datadog
* OpenObserve
* custom monitoring

Agents can use:

* Claude
* Codex
* Hermes
* OpenClaw
* future models
* custom agent frameworks

Building our own versions would unnecessarily increase scope.

---

## Stage 3 — MCP Gateway

The next idea was therefore:

```text
Existing Agent
      ↓
TrustRun MCP
      ↓
Policy
      ↓
Terminal 3 ADK
      ↓
Infrastructure
```

The agent could receive semantic tools such as:

```text
inspect_service()
get_service_logs()
restart_service()
restart_container()
deploy_service()
```

This was better, because the intelligence layer became replaceable.

However, a critical security issue remained.

Installing an MCP server does **not force an agent to use that MCP server**.

An agent could potentially bypass TrustRun:

```text
Agent
├── TrustRun MCP
│      ↓
│   secure execution
│
└── SSH / shell / curl / Docker
       ↓
   bypass TrustRun
```

Therefore MCP alone is not the security boundary.

---

# 4. Final Architecture Decision

TrustRun should focus on a **safe execution environment for AI agents**.

The important principle is:

> Do not force the agent to choose the secure path. Remove the insecure privileged paths.

The user explicitly launches their agent inside TrustRun.

Example future UX:

```bash
trustrun run claude
```

```bash
trustrun run codex
```

```bash
trustrun run hermes
```

Outside TrustRun:

```text
Agent
→ normal user permissions
```

Inside TrustRun:

```text
Agent Sandbox
├── normal development tools
├── project filesystem
├── restricted network
├── no production credentials
├── no direct production SSH
└── TrustRun MCP capabilities
         ↓
      Policy Gate
         ↓
   Trusted Execution
         ↓
    Target System
```

This gives users a deliberate choice.

They can use an agent normally when they accept full local permissions.

They can use TrustRun when operating against sensitive systems.

---

# 5. Core Security Principle

Treat the AI agent as **untrusted**.

TrustRun must not rely on:

```text
"Please do not run dangerous commands."
```

Instead:

```text
Agent wants arbitrary action
        ↓
Environment prevents unauthorized access
        ↓
Privileged operations require TrustRun capability
        ↓
Policy evaluates request
        ↓
Trusted executor performs allowed operation
```

Equivalent principle:

> The safe path should be the only privileged path available.

---

# 6. Security Layers

TrustRun should conceptually contain four major layers.

## Layer 1 — Isolation

Controls the environment available to the agent.

Possible mechanisms:

```text
container
Linux namespace
sandbox
restricted filesystem
network policy
process isolation
```

Purpose:

* prevent access to host credentials
* prevent arbitrary production SSH
* restrict filesystem access
* restrict privileged networking
* reduce blast radius

---

## Layer 2 — Capability Interface

Expose privileged actions using MCP.

Example:

```text
trust.inspect_service
trust.read_logs
trust.restart_service
trust.inspect_container
trust.restart_container
trust.deploy_service
```

Do **not** expose:

```text
run_command(command)
execute_shell(script)
sudo(command)
```

These recreate unrestricted shell access.

Prefer semantic capabilities.

Bad:

```text
run_command("systemctl restart nginx")
```

Better:

```text
restart_service("nginx")
```

---

## Layer 3 — Policy Gating

Every privileged capability must pass policy checks.

Example:

```text
restart nginx              → ALLOW
restart API container      → ALLOW
restart PostgreSQL         → REQUIRE APPROVAL
kill arbitrary PID         → DENY
modify sshd_config         → DENY
disable firewall           → DENY
delete arbitrary path      → DENY
```

Policies may eventually support:

```text
agent identity
target host
service
environment
action type
rate limit
time window
approval requirement
resource limit
risk level
```

---

## Layer 4 — Trusted Execution

Terminal 3 ADK should be evaluated/used here.

Terminal 3 is not the agent framework.

Its role is:

```text
identity
authentication
authorization
secret isolation
TEE-backed execution
policy enforcement
auditability
```

Conceptually:

```text
Agent
  ↓
TrustRun MCP
  ↓
Policy
  ↓
Terminal 3 ADK
  ↓
TEE / protected executor
  ↓
credential usage
  ↓
VPS / Docker / API
```

The agent should receive:

```json
{
  "success": true,
  "service": "nginx",
  "status": "running"
}
```

It should **not receive**:

```text
SSH private key
root password
production API token
```

---

# 7. Important Terminal 3 Understanding

Terminal 3 ADK should not be treated as:

> Encrypt a secret and pass the decrypted value to the agent.

That would defeat the purpose.

Instead:

```text
Agent requests capability
        ↓
Trusted environment accesses secret
        ↓
Trusted environment performs operation
        ↓
Agent receives result
```

The sensitive credential remains outside the agent runtime.

TrustRun may still require bootstrap configuration such as:

```env
T3N_...
```

but downstream infrastructure credentials should ideally remain inside the trusted execution boundary.

---

# 8. First Use Case

TrustRun should be generic at the core, but the first reference implementation should focus on:

# Linux VPS / Self-Hosted Infrastructure

Typical environment:

```text
Ubuntu VPS
├── Docker / Docker Compose
├── systemd
├── Nginx
├── application services
└── PostgreSQL
```

Initial capabilities could include:

```text
get_system_health()
get_disk_usage()
get_memory_usage()
get_service_status()
get_service_logs()
get_container_status()
get_container_logs()

restart_service()
restart_container()
```

Possible later capabilities:

```text
deploy_service()
rollback_deployment()
rotate_application_logs()
reload_nginx()
run_health_check()
```

High-risk actions should initially remain unsupported or require explicit approval.

---

# 9. Observability Is NOT TrustRun's Responsibility

TrustRun should not rebuild Grafana, Prometheus, Datadog, etc.

Observability is an external input.

Possible future integrations:

```text
Prometheus
Grafana
Loki
OpenTelemetry
Datadog
OpenObserve
custom logs
```

TrustRun may expose read-only adapters where useful, but observability infrastructure should remain user-selected.

Example:

```text
Prometheus Alert
       ↓
Claude / Codex / Hermes
       ↓
TrustRun
       ↓
authorized remediation
```

---

# 10. Intelligence Is NOT TrustRun's Responsibility

TrustRun should not require its own LLM.

The user chooses the intelligence layer.

Possible agents:

```text
Claude Code
Codex
Hermes
OpenClaw
custom MCP client
future agents
```

TrustRun should remain model-independent.

This is intentional because:

* models evolve quickly
* context windows change
* agent frameworks change
* different users prefer different agents
* intelligence quality should not affect execution security

---

# 11. MCP's Role

MCP is the interoperability layer.

It allows TrustRun capabilities to be consumed by many agents.

Conceptually:

```text
Claude ─┐
Codex  ─┤
Hermes ─┼─→ TrustRun MCP → Policy → Trusted Execution
OpenClaw─┤
Custom ──┘
```

However:

> MCP itself is not sufficient security.

If the agent still possesses production credentials or unrestricted network access, it may bypass MCP.

Therefore TrustRun must combine:

```text
MCP
+
sandboxing
+
credential isolation
+
network restrictions
+
policy
+
trusted execution
```

---

# 12. User Experience

A possible future CLI:

```bash
trustrun init
```

Creates project configuration.

Example:

```text
.trustrun/
├── policy.yaml
├── targets.yaml
└── config.yaml
```

Launch agent:

```bash
trustrun run claude
```

or:

```bash
trustrun run codex
```

Inspect policies:

```bash
trustrun policy list
```

Test policy:

```bash
trustrun policy check restart_service nginx
```

View audit history:

```bash
trustrun audit
```

These names are conceptual and may change.

---

# 13. Example Policy

Possible conceptual configuration:

```yaml
targets:
  production:
    type: ssh
    host: prod.example.com

capabilities:
  inspect_service:
    effect: allow

  read_logs:
    effect: allow

  restart_service:
    allow:
      - nginx
      - api
    require_approval:
      - postgresql

  restart_container:
    allow:
      - api
      - worker

  modify_firewall:
    effect: deny

  arbitrary_shell:
    effect: deny
```

Do not commit to this exact schema yet.

First define the domain model cleanly.

---

# 14. Example Runtime Flow

Incident:

```text
API returns repeated HTTP 500
```

Agent:

```text
1. Calls get_service_status("api")
2. Calls get_service_logs("api")
3. Determines service should restart
4. Calls restart_service("api")
```

TrustRun:

```text
1. Authenticate agent
2. Validate capability
3. Validate target
4. Evaluate policy
5. Resolve protected credential
6. Execute restart
7. Record audit event
8. Return structured result
```

Agent:

```text
1. Calls health check
2. Verifies API recovered
3. Reports outcome to user
```

---

# 15. Threat Model

Assume:

```text
LLM may be compromised
LLM may hallucinate
LLM may be prompt-injected
agent instructions may be ignored
agent plugins may behave unexpectedly
```

TrustRun should protect against:

```text
credential exposure
unauthorized infrastructure access
arbitrary privileged commands
unexpected target access
privilege escalation
unsafe agent tool invocation
```

TrustRun does NOT initially need to protect against every host-kernel or container escape vulnerability.

Define realistic security boundaries.

---

# 16. Why Not AGENTS.md / CLAUDE.md / Skills?

These remain useful for agent behavior.

Example:

```text
Use TrustRun when interacting with production.
```

But they must be treated as guidance.

They are not enforcement mechanisms.

Trust model:

```text
Instructions → improve behavior
Sandbox      → restrict environment
MCP          → expose capabilities
Policy       → authorize capability
T3           → protect privileged execution
```

---

# 17. Relationship to Sandbox / Harness Engineering

TrustRun incorporates ideas from both.

## Harness Engineering

Useful for:

```text
tool descriptions
agent instructions
context
structured output
workflow guidance
```

But harness engineering influences the model rather than enforcing permissions.

---

## Sandbox

Provides actual environmental isolation.

This is essential to TrustRun.

The agent should be allowed to perform normal local development actions while being prevented from reaching privileged targets directly.

---

## Capability Security

TrustRun should follow capability-oriented design.

Instead of:

```text
Here is the SSH key.
Do whatever you need.
```

provide:

```text
restart_service("api")
```

The capability itself defines what authority is granted.

---

# 18. Similarity to ERC-4337 Policy Accounts

A useful mental model came from blockchain smart accounts.

ERC-4337 policy accounts can ensure:

```text
Agent may request anything
        ↓
Smart account enforces mandate
        ↓
Unauthorized transaction cannot execute
```

TrustRun attempts to bring a similar principle to off-chain infrastructure:

```text
Agent may request anything
        ↓
Execution environment + policy restrict authority
        ↓
Unauthorized infrastructure action cannot execute
```

However, off-chain enforcement requires more components because there is no blockchain acting as the universal execution boundary.

That is why sandboxing and credential isolation matter.

---

# 19. Competitor / Market Context

Do not assume TrustRun is the first agent security gateway.

Existing categories include:

```text
MCP gateways
agent authorization gateways
agent sandboxes
policy engines
AI security middleware
```

Examples discussed during research include:

```text
agentgateway
Permit MCP Gateway
AWS AgentCore Gateway
OpenSRE-style systems
policy-gated DevOps agents
```

Some existing tools already provide:

```text
authentication
authorization
MCP routing
rate limits
tool allowlists
audit logs
```

Therefore TrustRun should NOT position itself merely as:

> MCP authorization gateway.

The intended differentiation is:

> TrustRun controls the actual privileged execution boundary rather than only deciding whether an MCP request may pass.

Core distinction:

```text
Traditional MCP Gateway
Agent → authorization → MCP server
```

versus:

```text
TrustRun
Agent
  ↓
isolated environment
  ↓
capability gateway
  ↓
policy
  ↓
credential isolation
  ↓
trusted execution
  ↓
target infrastructure
```

---

# 20. Project Scope

## IN SCOPE

Initial MVP:

```text
CLI
agent sandbox
MCP server
capability registry
policy engine
Linux VPS adapter
read-only inspection tools
restricted remediation tools
audit logging
Terminal 3 integration experiment
```

First target:

```text
Ubuntu
systemd
Docker
```

---

## OUT OF SCOPE FOR MVP

Do not start with:

```text
AWS
GCP
Azure
Kubernetes
multi-cloud
full observability platform
custom AI model
custom agent framework
full SIEM
enterprise IAM platform
arbitrary shell execution
```

These can be future adapters.

---

# 21. Suggested High-Level Architecture

```text
┌─────────────────────────────────────────────┐
│ Existing AI Agent                           │
│ Claude / Codex / Hermes / OpenClaw / Other │
└───────────────────┬─────────────────────────┘
                    │
              TrustRun Runtime
                    │
       ┌────────────┴────────────┐
       │                         │
┌──────▼────────┐        ┌───────▼────────┐
│ Agent Sandbox │        │ TrustRun MCP   │
│               │        │ Capability API │
│ restricted FS │        └───────┬────────┘
│ restricted net│                │
│ no prod creds │        ┌───────▼────────┐
└───────────────┘        │ Policy Engine  │
                         │ allow           │
                         │ deny            │
                         │ approval        │
                         └───────┬────────┘
                                 │
                         ┌───────▼─────────┐
                         │ Trusted Exec    │
                         │ Terminal 3 ADK  │
                         │ credential use  │
                         └───────┬─────────┘
                                 │
                         ┌───────▼─────────┐
                         │ Target Adapter  │
                         │ Linux / Docker  │
                         └───────┬─────────┘
                                 │
                         ┌───────▼─────────┐
                         │ VPS             │
                         └─────────────────┘
```

---

# 22. Engineering Principles

Follow these principles throughout development.

## 1. Default deny

Unknown privileged capabilities should not execute.

---

## 2. No arbitrary shell capability

Avoid APIs equivalent to:

```text
exec(command)
```

---

## 3. Least privilege

Expose only the minimum capability required.

---

## 4. Separate planning from execution

The agent determines desired action.

TrustRun determines whether the action may actually occur.

---

## 5. Keep secrets outside the agent

The agent should not receive infrastructure credentials.

---

## 6. Structured tool interfaces

Prefer:

```json
{
  "service": "nginx"
}
```

over:

```json
{
  "command": "sudo systemctl restart nginx"
}
```

---

## 7. Auditable execution

Record at minimum:

```text
agent
capability
target
policy decision
timestamp
result
duration
```

Never log sensitive credentials.

---

## 8. Agent agnostic

Do not tightly couple the core to Claude, Codex, or any single framework.

---

## 9. Observability agnostic

Do not require Prometheus/Grafana to use TrustRun.

---

## 10. Security before autonomy

Do not maximize autonomous capabilities before the enforcement model is correct.

---

# 23. MVP Proposal

A good first milestone is intentionally small.

## Capability Set

Read-only:

```text
system.health
system.disk_usage
system.memory_usage

service.status
service.logs

container.status
container.logs
```

Write:

```text
service.restart

container.restart
```

Policy:

```text
allow
deny
approval_required
```

Targets:

```text
one Linux VPS
```

Agent integration:

```text
one MCP-compatible coding agent
```

Execution:

```text
Terminal 3 proof-of-concept
```

Sandbox:

```text
container-based or Linux sandbox
```

This is enough to validate the architecture.

---

# 24. Example Demo

The demo should clearly prove that TrustRun adds an actual security boundary.

Scenario:

```text
Agent runs inside TrustRun.
```

Agent tries:

```text
restart_service("api")
```

Result:

```text
ALLOW
```

Agent tries:

```text
restart_service("postgresql")
```

Result:

```text
APPROVAL_REQUIRED
```

Agent tries:

```text
modify_firewall()
```

Result:

```text
DENY
```

Agent tries direct SSH:

```bash
ssh root@production
```

Result:

```text
network/credential access denied
```

This final case is extremely important.

It demonstrates that TrustRun is not merely relying on MCP policy.

---

# 25. Key Project Statement

Use this as the central definition:

> **TrustRun is an agent-agnostic safe execution environment that prevents AI agents from directly accessing privileged infrastructure credentials and instead exposes narrowly scoped, policy-controlled capabilities through a trusted execution gateway.**

Shorter version:

> **TrustRun gives AI agents capabilities, not credentials.**

---

# 26. Project Formula

```text
TrustRun is a trusted execution layer
for developers using autonomous AI agents
to safely perform privileged infrastructure actions
without exposing unrestricted credentials or relying on prompt-based rules.
```

---

# 27. Current Priority

Do not start by implementing many integrations.

The first engineering task should be to validate the security architecture.

Recommended order:

```text
1. Define threat model
2. Define trust boundaries
3. Define capability model
4. Define policy model
5. Design sandbox boundary
6. Design MCP interface
7. Design execution abstraction
8. Validate Terminal 3 ADK integration
9. Implement Linux VPS adapter
10. Build minimal CLI
11. Add audit trail
12. Create end-to-end demo
```

Before writing significant code, challenge every privileged path with this question:

> Can the agent bypass TrustRun and reach the protected resource another way?

If yes, the security model is incomplete.

---

# 28. Final Design Principle

The most important principle in TrustRun is:

> **Never depend on an AI agent choosing to obey security rules. Design the environment so unauthorized privileged actions are technically unavailable.**

Everything else should be designed around that constraint.

---

# 29. Validated v1 Scope (Supersedes Earlier MVP Breadth)

The design review narrowed the first implementation to one demonstrable trusted path. Where this section conflicts with earlier MVP proposals, this section wins.

## Exact claim

> **TrustRun v1 demonstrates that an untrusted AI agent with arbitrary code execution inside an isolated sandbox can invoke two predefined privileged service-management capabilities through Terminal 3, while remaining unable to access the executor credential, directly authenticate to the management executor, choose arbitrary privileged commands, or operate outside the executor's fixed authority.**

This protects the **privileged management plane**, not every public application endpoint. The agent may access the public application surface like any internet client; attacks through that surface are outside v1 scope.

## Fixed v1 path

```text
Agent sandbox
  → session-scoped TrustRun MCP
  → T3 contract: status() | restart()
  → authenticated HTTPS executor
  → fixed local helper
  → my-api.service
```

There is exactly one service and two capabilities:

```text
service.status
service.restart
```

No user-controlled target, service name, command, URL, headers, HTTP body, path, or operation crosses the trusted boundary. The T3 contract owns the fixed executor destination and protected credential.

## Trust boundaries

Untrusted:

```text
agent, prompts, generated code, workspace, and all sandbox processes
```

Trusted:

```text
host OS/runtime, TrustRun launcher/policy/configuration, T3 execution path,
executor, and VPS privileged helper
```

Sandbox escape, host compromise, executor compromise, and Terminal 3 compromise are outside the v1 threat model. The sandbox must have no production credentials, Docker socket, host mounts, privileged network interfaces, or trusted configuration mounts. Session exit revokes new MCP access, kills the sandbox cgroup, and removes the session channel; an already-dispatched bounded operation may complete.

## Executor contract

The executor is a narrow, remotely reachable HTTPS management endpoint. It must:

- Require a T3-held, high-entropy bearer over validated TLS (or mTLS if the T3 spike proves it).
- Expose only fixed `service.status` and `service.restart` handlers for `my-api.service`.
- Use a fixed JSON schema, small request limits, timeouts, connection limits, and safe audit metadata; never log authentication headers.
- Run unprivileged and invoke only a root-owned, no-argument helper that restarts `my-api.service`.
- Return fixed sanitized schemas; never return raw system output, logs, environment variables, command lines, or paths.
- Persist restart cooldown and single-flight state. If durable state is unavailable, deny writes. Unknown write outcomes are observed with `service.status`, never retried automatically.

Terminal 3 outbound allowlisting constrains the caller; executor authentication is the server-side enforcement boundary. The target management path must reject direct sandbox access independently.

## First build gate

Before building a CLI, approvals, generic policy, additional targets, Docker, SSH, logs, or multi-agent support, prove:

```text
T3 fixed contract → allowlisted HTTPS executor → authenticated fixed operation
```

The proof passes only when T3 can authenticate to the executor without exposing the credential to the agent, direct sandbox executor access fails, both capabilities return sanitized results, other operations fail, and repeated restart is blocked by durable guards.
