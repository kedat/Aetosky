import type { Earthquake, OverviewSnapshot } from "@earthquake/shared";

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
    const value = numberOrNull(properties.mag);
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
