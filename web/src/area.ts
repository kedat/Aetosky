import type { AreaBounds } from "@earthquake/shared";

export function normalizeArea(area: AreaBounds): AreaBounds {
  const { south, north } = area;
  if (!Object.values(area).every(Number.isFinite) || south < -90 || north > 90 || south >= north || area.east === area.west) throw new Error("Invalid map bounds");
  const span = area.east - area.west;
  if (Math.abs(span) >= 360) return { south, north, west: -180, east: 180 };
  let west = ((area.west + 180) % 360 + 360) % 360 - 180;
  let east = west + ((span % 360 + 360) % 360);
  if (east > 360) { west -= 360; east -= 360; }
  return { south, north, west, east };
}

export function sameArea(first: AreaBounds | null | undefined, second: AreaBounds | null | undefined): boolean {
  if (!first || !second) return !first && !second;
  return (["south", "north", "west", "east"] as const).every(key => Math.abs(first[key] - second[key]) < 1e-9);
}

export function areaLabel(area: AreaBounds | null | undefined): string {
  if (!area) return "Worldwide";
  const longitude = (value: number) => (((value + 180) % 360 + 360) % 360 - 180).toFixed(2);
  return `${area.south.toFixed(2)}° to ${area.north.toFixed(2)}° latitude; ${area.east - area.west >= 360 ? "all longitudes" : `${longitude(area.west)}° to ${longitude(area.east)}° longitude${area.west < -180 || area.east > 180 ? " (across date line)" : ""}`}`;
}
