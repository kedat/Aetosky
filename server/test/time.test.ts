import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { TimeRequest } from "@earthquake/shared";
import { createApp } from "../src/app.js";
import { InvalidTimeError, parseTimeQuery } from "../src/time.js";
import { loadTimeRange, MAX_EVENTS, UsgsError } from "../src/usgs.js";

const range = { preset: "custom", start: "2026-10-24T00:00:00.000Z", end: "2026-10-25T00:00:00.000Z" } as const;
const now = () => new Date("2026-10-25T09:00:00.999Z");
function feature(id = "one", time = Date.parse(range.end) - 1_000) {
  return { type: "Feature", id, properties: { type: "earthquake", time, mag: 2.3 }, geometry: { type: "Point", coordinates: [131, 31, 10] } };
}
function collection(features: unknown[] = [feature()]) {
  return { type: "FeatureCollection", metadata: { status: 200, generated: now().getTime() }, features };
}
function responding(count: unknown, result: unknown = collection()): typeof fetch {
  return async input => Response.json(String(input).includes("/count?") ? count : result);
}

test("parses defaults and relative presets without inheriting USGS's 30-day default", () => {
  assert.deepEqual(parseTimeQuery({}), { preset: "past-24-hours" });
  assert.deepEqual(parseTimeQuery({ preset: "past-7-days" }), { preset: "past-7-days" });
});

test("normalizes explicit offsets to UTC", () => {
  assert.deepEqual(parseTimeQuery({ preset: "custom", starttime: "2026-10-24T07:00:00+07:00", endtime: "2026-10-25T07:00:00+07:00" }), range);
});

for (const [name, query] of Object.entries({
  missingEnd: { preset: "custom", starttime: range.start },
  equal: { preset: "custom", starttime: range.start, endtime: range.start },
  reversed: { preset: "custom", starttime: range.end, endtime: range.start },
  invalidCalendar: { preset: "custom", starttime: "2026-02-30T00:00:00Z", endtime: range.end },
  noOffset: { preset: "custom", starttime: "2026-10-24T00:00:00", endtime: range.end },
  duplicatedPreset: { preset: ["custom", "past-7-days"] },
  incompatibleParameters: { preset: "past-7-days", starttime: range.start },
})) {
  test(`rejects invalid time inputs: ${name}`, () => assert.throws(() => parseTimeQuery(query), InvalidTimeError));
}

test("counts and queries with the same explicit bounds and returns the exact requested scope", async () => {
  const urls: URL[] = [];
  const result = await loadTimeRange(range, { now, fetcher: async input => {
    const url = new URL(String(input)); urls.push(url);
    if (url.pathname.endsWith("/count")) return Response.json({ count: 1, maxAllowed: 20000 });
    assert.equal(url.searchParams.get("limit"), String(MAX_EVENTS + 1));
    return Response.json(collection());
  } });
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.searchParams.get("eventtype"), "earthquake");
    assert.equal(url.searchParams.get("starttime"), range.start);
    assert.equal(url.searchParams.get("endtime"), range.end);
  }
  assert.deepEqual(result.scope.time, range);
  assert.equal(result.count, 1);
});

test("resolves a relative week once and shares a timeout across count and query", async () => {
  const urls: URL[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];
  const result = await loadTimeRange({ preset: "past-7-days" }, { now, fetcher: async (input, init) => {
    const url = new URL(String(input)); urls.push(url); signals.push(init?.signal);
    return Response.json(url.pathname.endsWith("/count") ? { count: 0 } : collection([]));
  } });
  assert.equal(result.scope.time.start, "2026-10-18T09:00:00.000Z");
  assert.equal(result.scope.time.end, "2026-10-25T09:00:00.000Z");
  assert.equal(urls[0]!.searchParams.get("endtime"), urls[1]!.searchParams.get("endtime"));
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[0], signals[1]);
});

test("rejects a count above 5,000 without downloading event records", async () => {
  let calls = 0;
  await assert.rejects(loadTimeRange(range, { fetcher: async () => {
    calls++; return Response.json({ count: 137275, maxAllowed: 20000, error: "Exceeds USGS limit" });
  } }), { code: "RESULT_LIMIT_EXCEEDED" });
  assert.equal(calls, 1);
});

test("allows exactly the cap, but catches growth between count and query", async () => {
  const success = await loadTimeRange(range, { fetcher: responding({ count: MAX_EVENTS }) });
  assert.equal(success.count, 1);
  await assert.rejects(loadTimeRange(range, { fetcher: responding({ count: MAX_EVENTS }, collection(Array.from({ length: MAX_EVENTS + 1 }, (_, index) => feature(String(index))))) }), { code: "RESULT_LIMIT_EXCEEDED" });
});

test("returns coherent empty scopes for empty GeoJSON and HTTP 204", async () => {
  const empty = await loadTimeRange(range, { fetcher: responding({ count: 0 }, collection([])) });
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.scope.time, range);
  const noContent = await loadTimeRange(range, { fetcher: async () => new Response(null, { status: 204 }) });
  assert.equal(noContent.count, 0);
  assert.deepEqual(noContent.scope.time, range);
  assert.equal(noContent.source.generatedAt, null);
});

test("rejects invalid counts and embedded GeoJSON errors instead of returning empty success", async () => {
  await assert.rejects(loadTimeRange(range, { fetcher: responding({ count: "1" }) }), { code: "UPSTREAM_INVALID_RESPONSE" });
  await assert.rejects(loadTimeRange(range, { fetcher: responding({ count: 1 }, { ...collection([]), metadata: { status: 400, error: "Search Error" } }) }), { code: "UPSTREAM_INVALID_RESPONSE" });
});

test("handles a plain-text oversized-query error after preflight", async () => {
  await assert.rejects(loadTimeRange(range, { fetcher: async input => String(input).includes("/count?")
    ? Response.json({ count: 1 }) : new Response("25000 matching events exceeds search limit of 20000", { status: 400 }) }), { code: "RESULT_LIMIT_EXCEEDED" });
});

test("encloses subsecond API bounds and filters events to the exact requested window", async () => {
  const exact = { preset: "custom", start: "2026-10-24T23:59:36.598Z", end: "2026-10-24T23:59:36.600Z" } as const;
  const result = await loadTimeRange(exact, { fetcher: async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("starttime"), "2026-10-24T23:59:36.000Z");
    assert.equal(url.searchParams.get("endtime"), "2026-10-24T23:59:37.000Z");
    return Response.json(url.pathname.endsWith("/count") ? { count: 2 } : collection([
      feature("inside", Date.parse("2026-10-24T23:59:36.599Z")), feature("outside", Date.parse("2026-10-24T23:59:36.900Z")),
    ]));
  } });
  assert.deepEqual(result.scope.time, exact);
  assert.deepEqual(result.events.map(event => event.id), ["inside"]);
});

test("the HTTP API rejects invalid inputs before invoking USGS and accepts valid custom ranges", async t => {
  const calls: TimeRequest[] = [];
  const server = createApp(undefined, async request => {
    calls.push(request);
    return loadTimeRange(request, { fetcher: responding({ count: 0 }, collection([])) });
  }).listen(0, "127.0.0.1");
  await once(server, "listening"); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/earthquakes`;
  const invalid = await fetch(`${url}?preset=custom&starttime=${range.end}&endtime=${range.start}`);
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
  const valid = await fetch(`${url}?preset=custom&starttime=${range.start}&endtime=${range.end}`);
  assert.equal(valid.status, 200);
  assert.deepEqual(calls, [range]);
});

test("the HTTP API distinguishes oversized results from an upstream failure", async t => {
  const server = createApp(undefined, async () => { throw new UsgsError("RESULT_LIMIT_EXCEEDED"); }).listen(0, "127.0.0.1");
  await once(server, "listening"); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/earthquakes?preset=past-7-days`);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "RESULT_LIMIT_EXCEEDED");
});
