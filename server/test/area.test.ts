import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { insideArea, normalizeArea } from "../src/area.js";
import { parseFilters, InvalidFilterError } from "../src/filters.js";
import { loadTimeRange } from "../src/usgs.js";
import { createApp } from "../src/app.js";

const crossing = { south: -30, north: 0, west: 170, east: 190 };
test("normalizes date-line crossings, shifted world copies, broad spans and the full world", () => {
  assert.deepEqual(normalizeArea({ ...crossing, east: -170 }), crossing);
  assert.deepEqual(normalizeArea({ ...crossing, west: 530, east: 550 }), crossing);
  assert.deepEqual(normalizeArea({ south: -30, north: 0, west: 100, east: 40 }), { south: -30, north: 0, west: -260, east: 40 });
  assert.deepEqual(normalizeArea({ ...crossing, west: -200, east: 200 }), { south: -30, north: 0, west: -180, east: 180 });
});
test("includes both sides and edges of the date line without including the opposite side", () => {
  for (const longitude of [170, 180, -180, -170, -175, 175]) assert.equal(insideArea(longitude, -20, crossing), true);
  assert.equal(insideArea(0, -20, crossing), false); assert.equal(insideArea(175, 10, crossing), false);
});
for (const query of [
  { minlatitude: "0" },
  { minlatitude: "-91", maxlatitude: "10", minlongitude: "0", maxlongitude: "10" },
  { minlatitude: "0", maxlatitude: "0", minlongitude: "0", maxlongitude: "10" },
  { minlatitude: "0", maxlatitude: "10", minlongitude: "10", maxlongitude: "10" },
  { minlatitude: "0", maxlatitude: "10", minlongitude: ["0", "10"], maxlongitude: "10" },
  { minlatitude: "0", maxlatitude: "10", minlongitude: "Infinity", maxlongitude: "10" },
]) test(`rejects invalid area: ${JSON.stringify(query)}`, () => assert.throws(() => parseFilters(query), InvalidFilterError));

test("combines area, time and magnitude in identical count/query parameters and filters exact scope", async () => {
  const filters = parseFilters({ preset: "custom", starttime: "2026-10-24T00:00:00Z", endtime: "2026-10-25T09:00:00Z",
    minlatitude: "-30", maxlatitude: "0", minlongitude: "170", maxlongitude: "-170", minmagnitude: "4", maxmagnitude: "6" });
  const urls: URL[] = [];
  const result = await loadTimeRange(filters, { fetcher: async input => {
    const url = new URL(String(input)); urls.push(url);
    return Response.json(url.pathname.endsWith("/count") ? { count: 3 } : {
      type: "FeatureCollection", metadata: { status: 200, generated: Date.parse("2026-10-25T09:00:00Z") },
      features: [175, -175, 0].map((longitude, index) => ({ type: "Feature", id: String(index), geometry: { type: "Point", coordinates: [longitude, -20, 10] }, properties: { type: "earthquake", time: Date.parse("2026-10-25T08:00:00Z"), mag: 5 } })),
    });
  } });
  assert.equal(result.count, 2); assert.deepEqual(result.scope.area, crossing);
  for (const url of urls) {
    assert.equal(url.searchParams.get("minlongitude"), "170"); assert.equal(url.searchParams.get("maxlongitude"), "190");
    assert.equal(url.searchParams.get("minmagnitude"), "4"); assert.equal(url.searchParams.get("maxmagnitude"), "6");
    assert.equal(url.searchParams.get("minlatitude"), "-30");
  }
});

test("disconnecting a client cancels upstream work", async t => {
  let started!: () => void, canceled!: () => void;
  const starting = new Promise<void>(resolve => { started = resolve; });
  const canceling = new Promise<void>(resolve => { canceled = resolve; });
  const server = createApp(undefined, async (_filters, signal) => {
    started();
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => { canceled(); reject(signal!.reason); }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening"); t.after(() => server.close());
  const controller = new AbortController();
  const response = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/earthquakes?preset=past-7-days`, { signal: controller.signal });
  await starting; controller.abort(); await assert.rejects(response, { name: "AbortError" }); await canceling;
});
