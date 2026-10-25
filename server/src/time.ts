import type { TimeRequest } from "@earthquake/shared";

export class InvalidTimeError extends Error {}

function explicitTime(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new InvalidTimeError("Provide a date and time with an explicit UTC offset.");
  }
  const calendar = value.slice(0, 19);
  const utcCalendar = new Date(`${calendar}Z`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !Number.isFinite(utcCalendar.getTime()) || utcCalendar.toISOString().slice(0, 19) !== calendar) {
    throw new InvalidTimeError("Provide valid calendar dates and times.");
  }
  return parsed.toISOString();
}

export function parseTimeQuery(query: Record<string, unknown>): TimeRequest {
  if (Object.keys(query).some(key => !["preset", "starttime", "endtime"].includes(key))) {
    throw new InvalidTimeError("Only time filters are supported at this stage.");
  }
  const preset = query.preset ?? "past-24-hours";
  if (preset === "past-24-hours" || preset === "past-7-days") {
    if (query.starttime !== undefined || query.endtime !== undefined) {
      throw new InvalidTimeError("Use Custom range to specify start and end times.");
    }
    return { preset };
  }
  if (preset !== "custom") throw new InvalidTimeError("Choose a supported time range.");
  const start = explicitTime(query.starttime);
  const end = explicitTime(query.endtime);
  if (Date.parse(start) >= Date.parse(end)) throw new InvalidTimeError("End time must be after start time.");
  return { preset, start, end };
}
