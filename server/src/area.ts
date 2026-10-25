import type { AreaBounds } from "@earthquake/shared";

export function normalizeArea(area: AreaBounds): AreaBounds {
  const { south, north } = area;
  if (!Object.values(area).every(Number.isFinite) || south < -90 || north > 90 || south >= north || area.east === area.west) throw new Error("Provide valid nonempty map bounds.");
  const span = area.east - area.west;
  if (Math.abs(span) >= 360) return { south, north, west: -180, east: 180 };
  let west = ((area.west + 180) % 360 + 360) % 360 - 180;
  let east = west + ((span % 360 + 360) % 360);
  if (east > 360) { west -= 360; east -= 360; }
  return { south, north, west, east };
}

export function insideArea(longitude: number, latitude: number, area: AreaBounds): boolean {
  const x = area.west + ((longitude - area.west) % 360 + 360) % 360;
  return latitude >= area.south && latitude <= area.north && x <= area.east;
}
