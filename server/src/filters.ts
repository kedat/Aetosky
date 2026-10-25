import type { EarthquakeRequest, MagnitudeBounds } from "@earthquake/shared";
import { parseTimeQuery } from "./time.js";
import { normalizeArea } from "./area.js";

export class InvalidFilterError extends Error {}

function magnitude(value: unknown, label: string): number | undefined {
  if (value === undefined || (typeof value === "string" && !value.trim())) return undefined;
  if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) {
    throw new InvalidFilterError(`${label} magnitude must be a finite number.`);
  }
  return Number(value);
}

export function parseFilters(query: Record<string, unknown>): EarthquakeRequest {
  if (Object.keys(query).some(key => !["preset", "starttime", "endtime", "minmagnitude", "maxmagnitude", "minlatitude", "maxlatitude", "minlongitude", "maxlongitude"].includes(key))) {
    throw new InvalidFilterError("Unsupported filter parameter.");
  }
  const { minmagnitude, maxmagnitude, minlatitude, maxlatitude, minlongitude, maxlongitude, ...time } = query;
  const bounds: MagnitudeBounds = {};
  const minimum = magnitude(minmagnitude, "Minimum");
  const maximum = magnitude(maxmagnitude, "Maximum");
  if (minimum !== undefined) bounds.minMagnitude = minimum;
  if (maximum !== undefined) bounds.maxMagnitude = maximum;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new InvalidFilterError("Maximum magnitude must be greater than or equal to minimum magnitude.");
  }
  let area;
  const coordinates = [minlatitude, maxlatitude, minlongitude, maxlongitude];
  if (coordinates.some(value => value !== undefined)) {
    if (coordinates.some(value => typeof value !== "string" || !value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))) throw new InvalidFilterError("Provide all four map bounds as finite numbers.");
    try { area = normalizeArea({ south: Number(minlatitude), north: Number(maxlatitude), west: Number(minlongitude), east: Number(maxlongitude) }); }
    catch { throw new InvalidFilterError("Provide valid nonempty map bounds within latitude −90 to 90."); }
  }
  return { ...parseTimeQuery(time), ...bounds, ...(area ? { area } : {}) };
}
