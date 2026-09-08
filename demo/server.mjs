import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const page = await readFile(join(directory, "index.html"));
const runtime = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`, "trustrun");
const trace = join(runtime, "demo-event.json");

function serviceStatus() {
  return new Promise((resolve) => {
    execFile("/usr/bin/systemctl", ["is-active", "--quiet", "my-api.service"], (error) => resolve(error ? "not_running" : "running"));
  });
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
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ service: await serviceStatus(), event: await event() }));
    return;
  }
  response.writeHead(404).end();
}).listen(4173, "127.0.0.1", () => console.log("TrustRun demo console: http://127.0.0.1:4173"));
