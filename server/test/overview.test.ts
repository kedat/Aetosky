import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../src/app.js";
import { FEED_URL, loadOverview, normalizeOverview, UsgsError } from "../src/usgs.js";

const generated = Date.parse("2026-10-25T09:26:57Z");
const retrievedAt = "2026-10-25T09:27:20.000Z";

function event(properties: Record<string, unknown> = {}, id = "sample") {
  return {
    type: "Feature", id,
    geometry: { type: "Point", coordinates: [131.873, 31.8226, 10] },
    properties: {
      type: "earthquake", mag: 5.3, magType: "mb", place: "Near Miyazaki, Japan",
      time: generated - 60_000, updated: generated - 30_000,
      status: "reviewed", url: "https://earthquake.usgs.gov/earthquakes/eventpage/sample",
      ...properties,
    },
  };
}

function feed(features: unknown[] = [event()]) {
  return { type: "FeatureCollection", metadata: { generated, status: 200 }, features };
}

test("normalizes longitude/latitude, millisecond times, and a coherent 24-hour scope", () => {
  const result = normalizeOverview(feed(), retrievedAt);
  const earthquake = result.events[0]!;
  assert.equal(earthquake.longitude, 131.873);
  assert.equal(earthquake.latitude, 31.8226);
  assert.equal(earthquake.depthKm, 10);
  assert.equal(earthquake.occurredAt, "2026-10-25T09:25:57.000Z");
  assert.equal(earthquake.updatedAt, "2026-10-25T09:26:27.000Z");
  assert.deepEqual(result.scope, {
    area: "worldwide",
    time: { preset: "past-24-hours", start: "2026-10-24T09:26:57.000Z", end: "2026-10-25T09:26:57.000Z" },
    magnitude: { minimum: null, maximum: null },
  });
  assert.equal(result.source.generatedAt, result.scope.time.end);
  assert.equal(result.source.retrievedAt, retrievedAt);
  assert.equal(result.count, result.events.length);
});

test("keeps null, zero, and negative magnitudes/depths distinct", () => {
  const unknown = event({ mag: null, magType: null, place: null, status: null, updated: null, url: null }, "unknown");
  unknown.geometry.coordinates = [0, 0, 0];
  const zero = event({ mag: 0 }, "zero");
  zero.geometry.coordinates[2] = -1.42;
  const negative = event({ mag: -0.3 }, "negative");
  const result = normalizeOverview(feed([unknown, zero, negative]), retrievedAt);
  assert.equal(result.events[0]!.magnitude, null);
  assert.equal(result.events[0]!.depthKm, 0);
  assert.equal(result.events[0]!.updatedAt, null);
  assert.equal(result.events[0]!.place, null);
  assert.equal(result.events[1]!.magnitude, 0);
  assert.equal(result.events[1]!.depthKm, -1.42);
  assert.equal(result.events[2]!.magnitude, -0.3);
});

test("accepts missing optional fields, metadata.count, and bbox", () => {
  const result = normalizeOverview(feed([{ ...event(), properties: { type: "earthquake", time: generated } }]), retrievedAt);
  assert.equal(result.count, 1);
  assert.equal(result.events[0]!.magnitude, null);
  assert.equal(result.events[0]!.reviewStatus, null);
});

test("includes boundary times, excludes out-of-window and non-earthquake events, and sorts newest first", () => {
  const result = normalizeOverview(feed([
    event({ time: generated - 86_400_000 }, "start"),
    event({ time: generated - 86_400_001 }, "too-old"),
    event({ time: generated + 1 }, "future"),
    event({ type: "quarry blast" }, "blast"),
    event({ time: generated }, "end"),
  ]), retrievedAt);
  assert.deepEqual(result.events.map(item => item.id), ["end", "start"]);
  assert.equal(result.count, 2);
});

test("an empty collection is a successful zero-event snapshot", () => {
  const result = normalizeOverview(feed([]), retrievedAt);
  assert.deepEqual(result.events, []);
  assert.equal(result.count, 0);
  assert.equal(result.scope.time.end, new Date(generated).toISOString());
});

test("rejects error metadata even in an otherwise valid collection", () => {
  assert.throws(() => normalizeOverview({ ...feed([]), metadata: { generated, status: 400, error: "Search Error" } }, retrievedAt), UsgsError);
});

test("rejects malformed records rather than silently displaying incomplete results", () => {
  const malformed = event();
  malformed.geometry.coordinates = [NaN, 31, 10];
  for (const payload of [null, {}, { ...feed(), features: null }, feed([malformed]), feed([event(), event()])]) {
    assert.throws(() => normalizeOverview(payload, retrievedAt), UsgsError);
  }
});

test("requests the real past-day endpoint and returns the normalized snapshot", async () => {
  const result = await loadOverview({
    now: () => new Date(retrievedAt),
    fetcher: async (input, init) => {
      assert.equal(input, FEED_URL);
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json(feed());
    },
  });
  assert.equal(result.count, 1);
  assert.equal(result.source.retrievedAt, retrievedAt);
});

test("accepts HTTP 204 without trying to parse a JSON body", async () => {
  const result = await loadOverview({
    now: () => new Date(retrievedAt),
    fetcher: async () => new Response(null, { status: 204 }),
  });
  assert.equal(result.count, 0);
  assert.equal(result.source.generatedAt, null);
  assert.equal(result.scope.time.end, retrievedAt);
});

test("maps HTTP failures, network errors, and malformed JSON to an upstream failure", async () => {
  const fetchers: (typeof fetch)[] = [
    async () => new Response("Unavailable", { status: 503 }),
    async () => { throw new TypeError("Network failure"); },
    async () => new Response("not JSON"),
  ];
  for (const fetcher of fetchers) {
    await assert.rejects(loadOverview({ fetcher }), { code: "UPSTREAM_UNAVAILABLE" });
  }
});

test("passes an expiring timeout signal to upstream fetch", async () => {
  await assert.rejects(loadOverview({ timeoutMs: 1, fetcher: async (_input, init) => {
    await delay(15);
    assert.equal(init?.signal?.aborted, true);
    throw init?.signal?.reason;
  } }), { code: "UPSTREAM_UNAVAILABLE" });
});

async function listen(load: Parameters<typeof createApp>[0]): Promise<{ server: Server; url: string }> {
  const server = createApp(load).listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/earthquakes` };
}

test("HTTP endpoint returns the entire snapshot with no-store caching", async t => {
  const expected = normalizeOverview(feed(), retrievedAt);
  const { server, url } = await listen(async () => expected);
  t.after(() => server.close());
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), expected);
});

test("HTTP endpoint reports a failure instead of a misleading empty success", async t => {
  const { server, url } = await listen(async () => { throw new UsgsError("UPSTREAM_UNAVAILABLE"); });
  t.after(() => server.close());
  const response = await fetch(url);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(body.events, undefined);
});

test("unsupported query parameters are rejected rather than silently ignored", async t => {
  let calls = 0;
  const { server, url } = await listen(async () => { calls++; return normalizeOverview(feed(), retrievedAt); });
  t.after(() => server.close());
  const response = await fetch(`${url}?unknown=5`);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
