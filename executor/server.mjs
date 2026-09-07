import { timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { DatabaseSync } from "node:sqlite";

const SERVICE = "my-api.service";
const MAX_BODY_BYTES = 64;
const MAX_CONNECTIONS = 16;
export const RESTART_COOLDOWN_MS = 600_000;

function exactEmptyObject(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return false;
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function bearerMatches(header, expected) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error) => resolve(!error));
  });
}

export class RestartState {
  constructor(path, cooldownMs) {
    this.cooldownMs = cooldownMs;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS restart_state (id INTEGER PRIMARY KEY CHECK (id = 1), cooldown_until_ms INTEGER NOT NULL, in_flight INTEGER NOT NULL); INSERT OR IGNORE INTO restart_state VALUES (1, 0, 0);");
  }

  reserve(now) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.db.prepare("SELECT cooldown_until_ms, in_flight FROM restart_state WHERE id = 1").get();
      if (!state) throw new Error("state missing");
      if (state.in_flight) {
        this.db.exec("COMMIT");
        return "in_flight";
      }
      if (state.cooldown_until_ms > now) {
        this.db.exec("COMMIT");
        return "cooldown";
      }
      this.db.prepare("UPDATE restart_state SET cooldown_until_ms = ?, in_flight = 1 WHERE id = 1").run(now + this.cooldownMs);
      this.db.exec("COMMIT");
      return "granted";
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  complete() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE restart_state SET in_flight = 0 WHERE id = 1").run();
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

export function createExecutor(config) {
  const state = new RestartState(config.statePath, config.cooldownMs);
  const send = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  };

  const server = createServer({ cert: readFileSync(config.certPath), key: readFileSync(config.keyPath), minVersion: "TLSv1.3" }, (request, response) => {
    if (!bearerMatches(request.headers.authorization, config.bearer)) return send(response, 401, { ok: false, code: "unauthorized" });
    if (request.method !== "POST" || (request.url !== "/v1/service/status" && request.url !== "/v1/service/restart")) return send(response, 404, { ok: false, code: "not_found" });
    if (request.headers["content-type"] !== "application/json") return send(response, 400, { ok: false, code: "invalid_request" });
    if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return send(response, 400, { ok: false, code: "invalid_request" });

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) request.destroy();
    });
    request.on("end", async () => {
      if (!exactEmptyObject(body)) return send(response, 400, { ok: false, code: "invalid_request" });
      if (request.url === "/v1/service/status") {
        const running = await run("/usr/bin/systemctl", ["is-active", "--quiet", SERVICE], 3_000);
        return send(response, 200, { ok: true, service: "my-api", status: running ? "running" : "not_running" });
      }

      let reservation;
      try {
        reservation = state.reserve(Date.now());
      } catch {
        return send(response, 503, { ok: false, code: "state_unavailable" });
      }
      if (reservation !== "granted") return send(response, 409, { ok: false, code: reservation === "cooldown" ? "cooldown" : "in_flight" });

      const restarted = await run("/usr/bin/sudo", ["-n", config.restartHelper], 10_000);
      try {
        state.complete();
      } catch {
        return send(response, 503, { ok: false, code: "state_unavailable" });
      }
      return send(response, restarted ? 200 : 502, restarted ? { ok: true, service: "my-api", status: "restart_requested" } : { ok: false, code: "restart_failed" });
    });
    request.on("error", () => response.destroy());
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on("close", () => state.close());
  return server;
}

if (import.meta.main) {
  const required = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const server = createExecutor({
    bearer: required("TRUSTRUN_EXECUTOR_BEARER"),
    certPath: required("TRUSTRUN_EXECUTOR_TLS_CERT"),
    keyPath: required("TRUSTRUN_EXECUTOR_TLS_KEY"),
    statePath: required("TRUSTRUN_EXECUTOR_STATE"),
    restartHelper: "/usr/local/libexec/trustrun-restart-my-api",
    cooldownMs: RESTART_COOLDOWN_MS,
  });
  server.listen(8443, "0.0.0.0");
}
