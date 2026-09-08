import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const page = await readFile(join(directory, "index.html"));
const runtime = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`, "trustrun");
const trace = join(runtime, "demo-event.json");
const stateDbPath = process.env.TRUSTRUN_EXECUTOR_STATE ?? "/var/lib/trustrun-executor/state.db";

function serviceStatus() {
  return new Promise((resolve) => {
    execFile("/usr/bin/systemctl", ["is-active", "--quiet", "my-api.service"], (error) => resolve(error ? "not_running" : "running"));
  });
}

function readCooldown() {
  try {
    const db = new DatabaseSync(stateDbPath, { readOnly: true });
    const row = db.prepare("SELECT cooldown_until_ms, in_flight FROM restart_state WHERE id = 1").get();
    db.close();
    if (!row) return { status: "ready", remainingSeconds: 0 };
    const now = Date.now();
    if (row.in_flight) return { status: "in_flight", remainingSeconds: 0 };
    if (row.cooldown_until_ms > now) {
      return {
        status: "cooldown",
        cooldownUntilMs: row.cooldown_until_ms,
        remainingSeconds: Math.ceil((row.cooldown_until_ms - now) / 1000),
      };
    }
    return { status: "ready", remainingSeconds: 0 };
  } catch {
    return { status: "unknown", remainingSeconds: 0 };
  }
}

async function event() {
  try {
    const value = JSON.parse(await readFile(trace, "utf8"));
    const allowed = value.capability === "service.status" ? ["running", "not_running"] : value.capability === "service.restart" ? ["restart_requested"] : [];
    if (!Number.isSafeInteger(value.at) || value.result?.ok !== true || value.result.service !== "my-api" || !allowed.includes(value.result.status)) return null;
    return value;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
    return;
  }
  if (request.url === "/api/state") {
    const payload = {
      service: await serviceStatus(),
      event: await event(),
      cooldown: readCooldown(),
      contract: {
        tail: "trustrun-v1",
        version: "0.1.5",
        environment: "Terminal 3 Testnet",
        address: "0x85ceb62f87bfcb3b5ba83a653913797399e204d3",
        service: "my-api.service",
      },
    };
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(payload));
    return;
  }
  response.writeHead(404).end();
}).listen(4173, "127.0.0.1", () => console.log("TrustRun demo console: http://127.0.0.1:4173"));
