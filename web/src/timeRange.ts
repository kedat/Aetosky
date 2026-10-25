import type { TimeRequest, TimePreset } from "@earthquake/shared";

export interface TimeDraft { preset: TimePreset; start: string; end: string }
export interface TimeErrors { start?: string; end?: string }

export function localDateTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function initialTimeDraft(): TimeDraft {
  const end = new Date();
  return { preset: "past-24-hours", start: localDateTime(new Date(end.getTime() - 86_400_000)), end: localDateTime(end) };
}

function localToUtc(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  // Round-tripping also rejects impossible dates and skipped local DST times.
  if (!Number.isFinite(date.getTime()) || localDateTime(date) !== value) return null;
  return date.toISOString();
}

export function validateTimeDraft(draft: TimeDraft): { request: TimeRequest | null; errors: TimeErrors } {
  if (draft.preset !== "custom") return { request: { preset: draft.preset }, errors: {} };
  const start = localToUtc(draft.start);
  const end = localToUtc(draft.end);
  const errors: TimeErrors = {};
  if (!start) errors.start = "Enter a valid start date and time.";
  if (!end) errors.end = "Enter a valid end date and time.";
  if (start && end && Date.parse(start) >= Date.parse(end)) errors.end = "End time must be after start time.";
  return { request: start && end && !errors.end ? { preset: "custom", start, end } : null, errors };
}

export function sameTimeRequest(first: TimeRequest | null, second: TimeRequest | null): boolean {
  if (!first || !second || first.preset !== second.preset) return false;
  return first.preset !== "custom" || (second.preset === "custom" && first.start === second.start && first.end === second.end);
}

export function periodLabel(preset: TimePreset): string {
  return preset === "past-24-hours" ? "Past 24 hours" : preset === "past-7-days" ? "Past 7 days" : "Custom range";
}
