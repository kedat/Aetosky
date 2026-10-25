import type { EarthquakeRequest, MagnitudeBounds, OverviewSnapshot } from "@earthquake/shared";
import { sameTimeRequest } from "./timeRange";

export interface MagnitudeDraft { minimum: string; maximum: string }
export interface MagnitudeErrors { minimum?: string; maximum?: string }

export function validateMagnitudeDraft(draft: MagnitudeDraft): { bounds: MagnitudeBounds | null; errors: MagnitudeErrors } {
  const errors: MagnitudeErrors = {};
  const bounds: MagnitudeBounds = {};
  const parse = (key: keyof MagnitudeDraft): number | undefined => {
    const value = draft[key].trim();
    if (!value) return undefined;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
      errors[key] = "Enter a finite number.";
      return undefined;
    }
    return Number(value);
  };
  const minimum = parse("minimum"), maximum = parse("maximum");
  if (minimum !== undefined) bounds.minMagnitude = minimum;
  if (maximum !== undefined) bounds.maxMagnitude = maximum;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) errors.maximum = "Maximum must be greater than or equal to minimum.";
  return { bounds: Object.keys(errors).length ? null : bounds, errors };
}

export function sameFilters(first: EarthquakeRequest | null, second: EarthquakeRequest | null): boolean {
  return !!first && !!second && sameTimeRequest(first, second) && first.minMagnitude === second.minMagnitude && first.maxMagnitude === second.maxMagnitude;
}

export function magnitudeLabel({ minimum, maximum }: OverviewSnapshot["scope"]["magnitude"]): string {
  if (minimum === null && maximum === null) return "All reported magnitudes";
  // Preserve the submitted precision rather than rounding a filter boundary.
  if (minimum === null) return `M ≤ ${maximum}`;
  if (maximum === null) return `M ≥ ${minimum}`;
  if (minimum === maximum) return `M ${minimum}`;
  return `M ${minimum} to ${maximum}`;
}
