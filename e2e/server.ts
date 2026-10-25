// Test-only upstream controls never enter the production API.
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../server/src/app.js";
import { loadOverview, loadTimeRange } from "../server/src/usgs.js";
import { FIXED_NOW, fixtureFeatures } from "./data.js";

const live = process.env.E2E_LIVE === "1";
let mode = "normal", delayMs = 0;
let requests: { path: string; parameters: Record<string, string> }[] = [];
const upstream = live ? null : createServer(async (request, response) => {
  const url = new URL(request.url!, "http://127.0.0.1:4912");
  response.setHeader("Content-Type", "application/json");
  if (url.pathname === "/__test/control") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    mode = body.mode ?? "normal"; delayMs = body.delayMs ?? 0;
    if (body.clear !== false) requests = [];
    response.end(JSON.stringify({ mode })); return;
  }
  if (url.pathname === "/__test/requests") { response.end(JSON.stringify(requests)); return; }
  requests.push({ path: url.pathname, parameters: Object.fromEntries(url.searchParams) });
  const currentMode = mode;
  await delay(currentMode === "timeout" ? 400 : delayMs);
  if (response.destroyed) return;
  if (currentMode === "failure") { response.statusCode = 503; response.end("USGS unavailable"); return; }
  if (currentMode === "malformed") { response.end("not JSON"); return; }
  if (currentMode === "no-content") { response.statusCode = 204; response.end(); return; }
  if (currentMode === "embedded-error") { response.end(JSON.stringify({ type: "FeatureCollection", metadata: { status: 400, error: "Invalid upstream response" }, features: [] })); return; }
  const features = currentMode === "empty" ? [] : fixtureFeatures(url.searchParams, url.pathname.includes("all_day"));
  if (url.pathname.endsWith("/count")) response.end(JSON.stringify({ count: currentMode === "oversized" ? 6001 : features.length, maxAllowed: 20000 }));
  else response.end(JSON.stringify({ type: "FeatureCollection", metadata: { status: 200, generated: Date.parse(FIXED_NOW), count: features.length }, features }));
}).listen(4912, "127.0.0.1");

const fixtureFetch: typeof fetch = (input, init) => {
  const official = new URL(String(input));
  return fetch(`http://127.0.0.1:4912${official.pathname}${official.search}`, init);
};
const app = live ? createApp() : createApp(
  signal => loadOverview({ fetcher: fixtureFetch, now: () => new Date(FIXED_NOW), timeoutMs: mode === "timeout" ? 80 : 15000, ...(signal ? { signal } : {}) }),
  (filters, signal) => loadTimeRange(filters, { fetcher: fixtureFetch, now: () => new Date(FIXED_NOW), timeoutMs: mode === "timeout" ? 80 : 15000, ...(signal ? { signal } : {}) }),
);
app.get("/__test/health", (_request, response) => response.json({ ready: true, live }));
const api = app.listen(4911, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  api.close(); upstream?.close(); process.exit(0);
});
