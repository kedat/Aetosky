export interface Earthquake {
  id: string;
  longitude: number;
  latitude: number;
  depthKm: number | null;
  magnitude: number | null;
  magnitudeType: string | null;
  place: string | null;
  occurredAt: string;
  updatedAt: string | null;
  reviewStatus: string | null;
  url: string | null;
}

export type TimePreset = "past-24-hours" | "past-7-days" | "custom";

export type TimeRequest =
  | { preset: "past-24-hours" | "past-7-days" }
  | { preset: "custom"; start: string; end: string };

export interface MagnitudeBounds { minMagnitude?: number; maxMagnitude?: number }
export interface AreaBounds { south: number; north: number; west: number; east: number }
export type EarthquakeRequest = TimeRequest & MagnitudeBounds & { area?: AreaBounds };

export interface OverviewSnapshot {
  events: Earthquake[];
  scope: {
    area: "worldwide" | AreaBounds;
    time: { preset: TimePreset; start: string; end: string };
    magnitude: { minimum: number | null; maximum: number | null };
  };
  count: number;
  source: {
    name: "USGS";
    url: string;
    generatedAt: string | null;
    retrievedAt: string;
  };
}

export interface ApiError {
  error: { code: string; message: string };
}
