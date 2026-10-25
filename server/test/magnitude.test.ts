import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { EarthquakeRequest } from "@earthquake/shared";
import { parseFilters, InvalidFilterError } from "../src/filters.js";
import { createApp } from "../src/app.js";
import { FEED_URL, loadTimeRange } from "../src/usgs.js";

const now = () => new Date("2026-10-25T09:00:00.000Z");
const range = { preset: "custom", start: "2026-10-24T00:00:00.000Z", end: "2026-10-25T00:00:00.000Z" } as const;
function feed(magnitudes: (number | null)[]) {
  return { type: "FeatureCollection", metadata: { generated: now().getTime(), status: 200 }, features: magnitudes.map((mag, index) => ({
    id: `event-${index}`, type: "Feature", geometry: { type: "Point", coordinates: [130, 30, 10] },
    properties: { type: "earthquake", mag, time: Date.parse(range.end) - 1_000 },
  })) };
}

test("parses independent, blank, zero, negative and equal magnitude bounds", () => {
  assert.deepEqual(parseFilters({ minmagnitude: "" }), { preset: "past-24-hours" });
  assert.deepEqual(parseFilters({ minmagnitude: "0" }), { preset: "past-24-hours", minMagnitude: 0 });
  assert.deepEqual(parseFilters({ maxmagnitude: "-0.5" }), { preset: "past-24-hours", maxMagnitude: -0.5 });
  assert.deepEqual(parseFilters({ minmagnitude: "4.5", maxmagnitude: "4.5" }), { preset: "past-24-hours", minMagnitude: 4.5, maxMagnitude: 4.5 });
  assert.deepEqual(parseFilters({ preset: "custom", starttime: range.start, endtime: range.end, minmagnitude: "3", maxmagnitude: "6" }), { ...range, minMagnitude: 3, maxMagnitude: 6 });
});

for (const value of ["NaN", "Infinity", "1e309", "abc", "0x10", ["1", "2"]]) {
  test(`rejects invalid or repeated magnitudes: ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseFilters({ minmagnitude: value }), InvalidFilterError);
  });
}

test("rejects reversed bounds and unsupported filters", () => {
  assert.throws(() => parseFilters({ minmagnitude: "6", maxmagnitude: "4" }), InvalidFilterError);
  assert.throws(() => parseFilters({ minlatitude: "10" }), InvalidFilterError);
});

test("sends the same magnitude bounds to count/query and preserves custom time", async () => {
  const urls: URL[] = [];
  const result = await loadTimeRange({ ...range, minMagnitude: 4, maxMagnitude: 6 }, { now, fetcher: async input => {
    const url = new URL(String(input)); urls.push(url);
    return Response.json(url.pathname.endsWith("/count") ? { count: 6 } : feed([4, 5, 6, null, 3.9, 6.1]));
  } });
  for (const url of urls) {
    assert.equal(url.searchParams.get("minmagnitude"), "4");
    assert.equal(url.searchParams.get("maxmagnitude"), "6");
    assert.equal(url.searchParams.get("starttime"), range.start);
    assert.equal(url.searchParams.get("endtime"), range.end);
  }
  assert.equal(urls.length, 2);
  assert.deepEqual(result.scope.time, range);
  assert.deepEqual(result.scope.magnitude, { minimum: 4, maximum: 6 });
  assert.deepEqual(result.events.map(event => event.magnitude), [4, 5, 6]);
});

for (const [name, bounds, expected] of [
  ["minimum only", { minMagnitude: 0 }, [0, 1]],
  ["maximum only", { maxMagnitude: 0 }, [-0.5, 0]],
  ["equal bounds", { minMagnitude: 0, maxMagnitude: 0 }, [0]],
  ["unrestricted", {}, [-0.5, 0, 1, null]],
] as const) {
  test(`applies inclusive ${name} filtering and the correct unknown-magnitude policy`, async () => {
    const result = await loadTimeRange({ ...range, ...bounds }, { fetcher: async input => Response.json(String(input).includes("/count?") ? { count: 4 } : feed([-0.5, 0, 1, null])) });
    assert.deepEqual(result.events.map(event => event.magnitude), [...expected]);
    assert.equal(result.count, expected.length);
  });
}

test("magnitude alone resolves an explicit day rather than a week or USGS's default month", async () => {
  const result = await loadTimeRange({ preset: "past-24-hours", minMagnitude: 0 }, { now, fetcher: async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("starttime"), "2026-10-24T09:00:00.000Z");
    assert.equal(url.searchParams.get("endtime"), "2026-10-25T09:00:00.000Z");
    assert.equal(url.searchParams.get("minmagnitude"), "0");
    assert.equal(url.searchParams.has("maxmagnitude"), false);
    return Response.json(url.pathname.endsWith("/count") ? { count: 0 } : feed([]));
  } });
  assert.equal(result.scope.time.preset, "past-24-hours");
  assert.deepEqual(result.scope.magnitude, { minimum: 0, maximum: null });
});

test("an unrestricted default still uses the past-day feed", async () => {
  const result = await loadTimeRange({ preset: "past-24-hours" }, { now, fetcher: async input => {
    assert.equal(input, FEED_URL); return Response.json(feed([null]));
  } });
  assert.deepEqual(result.scope.magnitude, { minimum: null, maximum: null });
  assert.equal(result.events[0]!.magnitude, null);
});

test("the result guard checks the combined filters before requesting records", async () => {
  let calls = 0;
  await assert.rejects(loadTimeRange({ ...range, minMagnitude: 2 }, { fetcher: async input => {
    calls++;
    assert.equal(new URL(String(input)).searchParams.get("minmagnitude"), "2");
    return Response.json({ count: 5001 });
  } }), { code: "RESULT_LIMIT_EXCEEDED" });
  assert.equal(calls, 1);
});

test("empty and 204 responses retain the applied magnitude scope", async () => {
  const result = await loadTimeRange({ ...range, maxMagnitude: 0 }, { fetcher: async input => String(input).includes("/count?") ? Response.json({ count: 0 }) : new Response(null, { status: 204 }) });
  assert.equal(result.count, 0);
  assert.deepEqual(result.scope.magnitude, { minimum: null, maximum: 0 });
});

test("the HTTP API routes magnitude-only requests to search and rejects invalid inputs first", async t => {
  const searched: EarthquakeRequest[] = [];
  let overviewCalls = 0;
  const overview = () => loadTimeRange({ preset: "past-24-hours" }, { now, fetcher: async () => Response.json(feed([])) });
  const server = createApp(async () => { overviewCalls++; return overview(); }, async request => {
    searched.push(request);
    return loadTimeRange(request, { now, fetcher: async input => Response.json(String(input).includes("/count?") ? { count: 0 } : feed([])) });
  }).listen(0, "127.0.0.1");
  await once(server, "listening"); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/earthquakes`;
  const invalid = await fetch(`${url}?minmagnitude=NaN`);
  assert.equal(invalid.status, 400);
  assert.equal(searched.length, 0);
  const valid = await fetch(`${url}?minmagnitude=0`);
  assert.equal(valid.status, 200);
  assert.deepEqual((await valid.json()).scope.magnitude, { minimum: 0, maximum: null });
  assert.deepEqual(searched, [{ preset: "past-24-hours", minMagnitude: 0 }]);
  await fetch(`${url}?minmagnitude=&maxmagnitude=`);
  assert.equal(overviewCalls, 1);
});
