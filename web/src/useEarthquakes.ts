import { useCallback, useEffect, useRef, useState } from "react";
import type { OverviewSnapshot, EarthquakeRequest, ApiError } from "@earthquake/shared";

interface RequestState {
  status: "loading" | "ready" | "error";
  snapshot: OverviewSnapshot | null;
  applied: EarthquakeRequest | null;
  requested: EarthquakeRequest;
  error: string | null;
  intent: "apply" | "reset";
}

function requestUrl(_time: EarthquakeRequest): string { return "/api/earthquakes"; }

function validSnapshot(snapshot: OverviewSnapshot, requested: EarthquakeRequest): boolean {
  const time = snapshot.scope?.time;
  const source = snapshot.source;
  const area = snapshot.scope?.area;
  const validArea = area === "worldwide" || (!!area && typeof area === "object" &&
    [area.south, area.north, area.west, area.east].every(Number.isFinite) && area.south >= -90 && area.north <= 90 && area.south < area.north && area.west < area.east);
  const nullableNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const ids = new Set<string>();
  return Array.isArray(snapshot.events) && snapshot.count === snapshot.events.length &&
    validArea && snapshot.events.every(event => {
      if (!event || typeof event.id !== "string" || ids.has(event.id)) return false;
      ids.add(event.id);
      return Number.isFinite(event.latitude) && Math.abs(event.latitude) <= 90 && Number.isFinite(event.longitude) && Math.abs(event.longitude) <= 180 &&
        nullableNumber(event.magnitude) && nullableNumber(event.depthKm) && date(event.occurredAt) && (event.updatedAt === null || date(event.updatedAt)) &&
        [event.magnitudeType, event.place, event.reviewStatus, event.url].every(nullableString);
    }) &&
    (snapshot.scope.area === "worldwide" && !requested.area) && time?.preset === requested.preset &&
    snapshot.scope.magnitude?.minimum === (requested.minMagnitude ?? null) && snapshot.scope.magnitude.maximum === (requested.maxMagnitude ?? null) &&
    source?.name === "USGS" && typeof source.url === "string" && Number.isFinite(Date.parse(source.retrievedAt)) &&
    (source.generatedAt === null || Number.isFinite(Date.parse(source.generatedAt))) &&
    Number.isFinite(Date.parse(time.start)) && Number.isFinite(Date.parse(time.end)) &&
    Date.parse(time.start) < Date.parse(time.end) &&
    (requested.preset !== "custom" || (time.start === requested.start && time.end === requested.end));
}

export function useEarthquakes() {
  const [state, setState] = useState<RequestState>({ status: "loading", snapshot: null, applied: null,
    requested: { preset: "past-24-hours" }, error: null, intent: "apply" });
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  const request = useCallback(async (input: EarthquakeRequest, intent: "apply" | "reset" = "apply") => {
    const requested = { ...input, ...(input.area ? { area: { ...input.area } } : {}) };
    const id = ++sequence.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    setState(previous => ({ ...previous, status: "loading", requested, error: null, intent }));
    try {
      const response = await fetch(requestUrl(requested), { signal: controller.signal });
      if (!response.ok) {
        let message = "Couldn't load earthquake data from USGS. Please try again.";
        try {
          const body: ApiError = await response.json();
          if (["INVALID_REQUEST", "RESULT_LIMIT_EXCEEDED"].includes(body.error?.code) && typeof body.error.message === "string") message = body.error.message;
        } catch { /* An upstream/proxy error may not have a JSON body. */ }
        throw new Error(message);
      }
      const snapshot: OverviewSnapshot = await response.json();
      if (!validSnapshot(snapshot, requested)) throw new Error("The earthquake service returned an invalid response. Please try again.");
      if (id !== sequence.current || controller.signal.aborted) return;
      // Commit results, their scope, and the applied intent together.
      setState({ status: "ready", snapshot, applied: requested, requested, error: null, intent });
    } catch (error) {
      if (id !== sequence.current || (controller.signal.aborted && !timedOut)) return;
      const message = timedOut ? "The request timed out. Please try again." : error instanceof TypeError || error instanceof SyntaxError
        ? "Couldn't load earthquake data. Check your connection and try again."
        : error instanceof Error ? error.message : "Earthquake data couldn't load. Please try again.";
      setState(previous => ({ ...previous, status: "error", error: message }));
    } finally {
      window.clearTimeout(deadline);
    }
  }, []);

  useEffect(() => {
    void request({ preset: "past-24-hours" });
    return () => { sequence.current++; active.current?.abort(); };
  }, [request]);

  return { state, request };
}
