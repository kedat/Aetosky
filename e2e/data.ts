export const FIXED_NOW = "2026-10-25T09:00:00.000Z";
export const records = [
  ["europe", 0, 20, 4.2, "Central overview event", "2026-10-25T08:00:00.000Z"],
  ["greece", 37, 35, 5.3, "Greece event", "2026-10-25T07:00:00.000Z"],
  ["japan", 131, 32, 5.3, "Japan event", "2026-10-25T06:00:00.000Z"],
  ["california", -120, 37, 2.1, "California event", "2026-10-25T05:00:00.000Z"],
  ["date-east", 175, -20, 4.8, "East date-line event", "2026-10-25T04:00:00.000Z"],
  ["date-west", -175, -18, 4.9, "West date-line event", "2026-10-25T03:00:00.000Z"],
  ["unknown", 10, -10, null, "Unknown magnitude event", "2026-10-25T02:00:00.000Z"],
  ["zero", -75, 0, 0, "Zero magnitude event", "2026-10-25T01:00:00.000Z"],
  ["older", 30, 10, 4.5, "Older weekly event", "2026-10-20T08:00:00.000Z"],
] as const;

export function fixtureFeatures(parameters: URLSearchParams, feed: boolean) {
  const end = feed ? Date.parse(FIXED_NOW) : Date.parse(parameters.get("endtime")!);
  const start = feed ? end - 86_400_000 : Date.parse(parameters.get("starttime")!);
  return records.filter(([, lon, lat, mag, , time]) => {
    if (Date.parse(time) < start || Date.parse(time) > end) return false;
    if (parameters.has("minmagnitude") && (mag === null || mag < Number(parameters.get("minmagnitude")))) return false;
    if (parameters.has("maxmagnitude") && (mag === null || mag > Number(parameters.get("maxmagnitude")))) return false;
    if (parameters.has("minlatitude")) {
      if (lat < Number(parameters.get("minlatitude")) || lat > Number(parameters.get("maxlatitude"))) return false;
      if (![-360, 0, 360].some(shift => lon + shift >= Number(parameters.get("minlongitude")) && lon + shift <= Number(parameters.get("maxlongitude")))) return false;
    }
    return true;
  }).map(([id, lon, lat, mag, place, time]) => ({ type: "Feature", id,
    geometry: { type: "Point", coordinates: [lon, lat, id === "zero" ? 0 : 10] },
    properties: { type: "earthquake", mag, magType: mag === null ? null : "mb", place, time: Date.parse(time), updated: null, status: "reviewed", url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}` },
  }));
}
