const UPSTREAM = "https://laptop-92gqc24v-1.tail7da546.ts.net";
const PATHS = new Set(["/v1/service/status", "/v1/service/restart"]);

function reject(code, status) {
  return Response.json({ ok: false, code }, { status, headers: { "cache-control": "no-store" } });
}

export async function handle(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (request.method !== "POST" || !PATHS.has(url.pathname)) return reject("not_found", 404);
  if (request.headers.get("content-type") !== "application/json" || (await request.text()) !== "{}") return reject("invalid_request", 400);
  try {
    const upstream = await fetcher(`${UPSTREAM}${url.pathname}`, {
      method: "POST",
      headers: { authorization: request.headers.get("authorization") ?? "", "content-type": "application/json" },
      body: "{}",
      redirect: "error",
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "cache-control": "no-store", "content-type": "application/json" } });
  } catch {
    return reject("unavailable", 502);
  }
}

export default { fetch: handle };
