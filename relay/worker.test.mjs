import assert from "node:assert/strict";
import { handle } from "./worker.mjs";

const calls = [];
const upstream = async (url, options) => {
  calls.push({ url, options });
  return Response.json({ ok: true, service: "my-api", status: "running" });
};
const request = new Request("https://trustrun-demo-relay.workers.dev/v1/service/status", { method: "POST", headers: { authorization: "Bearer demo", "content-type": "application/json" }, body: "{}" });
const response = await handle(request, upstream);
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { ok: true, service: "my-api", status: "running" });
assert.deepEqual(calls, [{ url: "https://laptop-92gqc24v-1.tail7da546.ts.net/v1/service/status", options: { method: "POST", headers: { authorization: "Bearer demo", "content-type": "application/json" }, body: "{}", redirect: "error" } }]);
assert.equal((await handle(new Request("https://trustrun-demo-relay.workers.dev/anything", { method: "POST" }), upstream)).status, 404);
assert.equal((await handle(new Request("https://trustrun-demo-relay.workers.dev/v1/service/status", { method: "POST", headers: { "content-type": "application/json" }, body: '{"unexpected":true}' }), upstream)).status, 400);
