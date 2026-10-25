import type { Earthquake, OverviewSnapshot, EarthquakeRequest } from "@earthquake/shared";
import { insideArea } from "./area.js";

export const FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
export const CATALOG_URL = "https://earthquake.usgs.gov/fdsnws/event/1/";
export const MAX_EVENTS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class UsgsError extends Error {
  constructor(public readonly code: "UPSTREAM_UNAVAILABLE" | "UPSTREAM_INVALID_RESPONSE" | "RESULT_LIMIT_EXCEEDED") {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsgsError("UPSTREAM_INVALID_RESPONSE");
  }
  return value as Record<string, unknown>;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numberOrNull = (value: unknown): number | null => finite(value) ? value : null;
const stringOrNull = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;

function timestamp(value: unknown): string | null {
  if (!finite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function snapshot(events: Earthquake[], end: string, generatedAt: string | null, retrievedAt: string,
  time: OverviewSnapshot["scope"]["time"] = { preset: "past-24-hours", start: new Date(Date.parse(end) - DAY_MS).toISOString(), end },
  sourceUrl = FEED_URL, magnitude: OverviewSnapshot["scope"]["magnitude"] = { minimum: null, maximum: null },
  area: OverviewSnapshot["scope"]["area"] = "worldwide"): OverviewSnapshot {
  return {
    events,
    scope: {
      area,
      time,
      magnitude,
    },
    count: events.length,
    source: { name: "USGS", url: sourceUrl, generatedAt, retrievedAt },
  };
}

function collection(payload: unknown) {
  const body = record(payload);
  const metadata = record(body.metadata);
  if (body.type !== "FeatureCollection" || !Array.isArray(body.features) ||
      !finite(metadata.status) || metadata.status >= 400 || metadata.error) {
    throw new UsgsError("UPSTREAM_INVALID_RESPONSE");
  }
  return { features: body.features, generatedAt: timestamp(metadata.generated) };
}

function normalizeEvents(features: unknown[], start: string, end: string,
  magnitude: OverviewSnapshot["scope"]["magnitude"] = { minimum: null, maximum: null }, area: OverviewSnapshot["scope"]["area"] = "worldwide"): Earthquake[] {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const events: Earthquake[] = [];
  const ids = new Set<string>();
  for (const feature of features) {
    const item = record(feature);
    const properties = record(item.properties);
    // Keep the same earthquake-only scope as future catalog requests.
    if (properties.type !== "earthquake") continue;
    const geometry = record(item.geometry);
    const coordinates = geometry.coordinates;
    const id = stringOrNull(item.id);
    const occurredAt = timestamp(properties.time);
    if (item.type !== "Feature" || geometry.type !== "Point" || !Array.isArray(coordinates) ||
        !finite(coordinates[0]) || !finite(coordinates[1]) || Math.abs(coordinates[0]) > 180 ||
        Math.abs(coordinates[1]) > 90 || !id || !occurredAt || ids.has(id)) {
      throw new UsgsError("UPSTREAM_INVALID_RESPONSE");
    }
    ids.add(id);
    const occurredMs = Date.parse(occurredAt);
    if (occurredMs < startMs || occurredMs > endMs) continue;
    if (area !== "worldwide" && !insideArea(coordinates[0], coordinates[1], area)) continue;
    const value = numberOrNull(properties.mag);
    if ((magnitude.minimum !== null || magnitude.maximum !== null) &&
        (value === null || (magnitude.minimum !== null && value < magnitude.minimum) || (magnitude.maximum !== null && value > magnitude.maximum))) continue;
    events.push({
      id,
      longitude: coordinates[0],
      latitude: coordinates[1],
      depthKm: numberOrNull(coordinates[2]),
      magnitude: value,
      magnitudeType: stringOrNull(properties.magType),
      place: stringOrNull(properties.place),
      occurredAt,
      updatedAt: timestamp(properties.updated),
      reviewStatus: stringOrNull(properties.status),
      url: stringOrNull(properties.url),
    });
  }
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return events;
}

export function normalizeOverview(payload: unknown, retrievedAt: string): OverviewSnapshot {
  const { features, generatedAt } = collection(payload);
  if (!generatedAt) throw new UsgsError("UPSTREAM_INVALID_RESPONSE");
  const start = new Date(Date.parse(generatedAt) - DAY_MS).toISOString();
  return snapshot(normalizeEvents(features, start, generatedAt), generatedAt, generatedAt, retrievedAt);
}

interface LoadOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function loadOverview({ fetcher = fetch, now = () => new Date(), timeoutMs = 15_000, signal }: LoadOptions = {}): Promise<OverviewSnapshot> {
  let response: Response;
  let payload: unknown;
  try {
    response = await fetcher(FEED_URL, {
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      headers: { Accept: "application/geo+json, application/json", "User-Agent": "EarthquakeExplorer/0.1" },
    });
    if (!response.ok) throw new Error("Upstream HTTP error");
    if (response.status === 204) {
      const retrievedAt = now().toISOString();
      return snapshot([], retrievedAt, null, retrievedAt);
    }
    // Consume the body under the same timeout as the connection.
    payload = await response.json();
  } catch {
    throw new UsgsError("UPSTREAM_UNAVAILABLE");
  }
  return normalizeOverview(payload, now().toISOString());
}

export async function loadTimeRange(request: EarthquakeRequest, { fetcher = fetch, now = () => new Date(), timeoutMs = 15_000, signal: callerSignal }: LoadOptions = {}): Promise<OverviewSnapshot> {
  const magnitude = { minimum: request.minMagnitude ?? null, maximum: request.maxMagnitude ?? null };
  const area = request.area ?? "worldwide";
  if (request.preset === "past-24-hours" && magnitude.minimum === null && magnitude.maximum === null && area === "worldwide") return loadOverview({ fetcher, now, timeoutMs, ...(callerSignal ? { signal: callerSignal } : {}) });
  // Resolve relative periods once, then reuse the exact bounds for count/query.
  const end = request.preset === "custom" ? request.end : new Date(Math.floor(now().getTime() / 1000) * 1000).toISOString();
  const time: OverviewSnapshot["scope"]["time"] = {
    preset: request.preset,
    start: request.preset === "custom" ? request.start : new Date(Date.parse(end) - (request.preset === "past-7-days" ? 7 : 1) * DAY_MS).toISOString(),
    end,
  };
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(callerSignal ? [callerSignal] : [])]);
  const parameters = new URLSearchParams({
    format: "geojson", eventtype: "earthquake",
    // Enclose subsecond bounds; normalizeEvents enforces the precise window.
    starttime: new Date(Math.floor(Date.parse(time.start) / 1000) * 1000).toISOString(),
    endtime: new Date(Math.ceil(Date.parse(time.end) / 1000) * 1000).toISOString(),
  });
  if (magnitude.minimum !== null) parameters.set("minmagnitude", String(magnitude.minimum));
  if (magnitude.maximum !== null) parameters.set("maxmagnitude", String(magnitude.maximum));
  if (area !== "worldwide") {
    parameters.set("minlatitude", String(area.south)); parameters.set("maxlatitude", String(area.north));
    parameters.set("minlongitude", String(area.west)); parameters.set("maxlongitude", String(area.east));
  }
  async function getJson(url: string): Promise<unknown | null> {
    try {
      const response = await fetcher(url, { signal, headers: { Accept: "application/json", "User-Agent": "EarthquakeExplorer/0.1" } });
      if (response.status === 204) return null;
      if (!response.ok) {
        const text = await response.text();
        if (response.status === 400 && text.includes("exceeds search limit")) throw new UsgsError("RESULT_LIMIT_EXCEEDED");
        throw new UsgsError("UPSTREAM_UNAVAILABLE");
      }
      return await response.json();
    } catch (error) {
      if (error instanceof UsgsError) throw error;
      throw new UsgsError("UPSTREAM_UNAVAILABLE");
    }
  }
  const counted = await getJson(`${CATALOG_URL}count?${parameters}`);
  const countBody = counted === null ? { count: 0 } : record(counted);
  if (!finite(countBody.count) || !Number.isInteger(countBody.count) || countBody.count < 0) throw new UsgsError("UPSTREAM_INVALID_RESPONSE");
  if (countBody.count > MAX_EVENTS) throw new UsgsError("RESULT_LIMIT_EXCEEDED");
  if (countBody.error || (finite(countBody.status) && countBody.status >= 400)) throw new UsgsError("UPSTREAM_INVALID_RESPONSE");
  parameters.set("orderby", "time");
  // One extra event detects growth since the count request, without truncating.
  parameters.set("limit", String(MAX_EVENTS + 1));
  const url = `${CATALOG_URL}query?${parameters}`;
  const payload = await getJson(url);
  const retrievedAt = now().toISOString();
  if (payload === null) return snapshot([], time.end, null, retrievedAt, time, url, magnitude, area);
  const { features, generatedAt } = collection(payload);
  if (features.length > MAX_EVENTS) throw new UsgsError("RESULT_LIMIT_EXCEEDED");
  return snapshot(normalizeEvents(features, time.start, time.end, magnitude, area), time.end, generatedAt, retrievedAt, time, url, magnitude, area);
}
