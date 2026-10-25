import express from "express";
import type { ApiError, OverviewSnapshot, EarthquakeRequest } from "@earthquake/shared";
import { loadOverview, loadTimeRange, UsgsError } from "./usgs.js";
import { InvalidTimeError } from "./time.js";
import { InvalidFilterError, parseFilters } from "./filters.js";

export function createApp(load: (signal?: AbortSignal) => Promise<OverviewSnapshot> = signal => loadOverview(signal ? { signal } : {}),
  search: (request: EarthquakeRequest, signal?: AbortSignal) => Promise<OverviewSnapshot> = (filters, signal) => loadTimeRange(filters, signal ? { signal } : {})) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/api/earthquakes", async (request, response) => {
    const controller = new AbortController();
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    response.set("Cache-Control", "no-store");
    try {
      const filters = parseFilters(request.query);
      const overview = filters.preset === "past-24-hours" && filters.minMagnitude === undefined && filters.maxMagnitude === undefined && !filters.area;
      const result = overview ? await load(controller.signal) : await search(filters, controller.signal);
      if (!controller.signal.aborted) response.json(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof InvalidTimeError || error instanceof InvalidFilterError) {
        response.status(400).json({ error: { code: "INVALID_REQUEST", message: error.message } } satisfies ApiError);
        return;
      }
      const code = error instanceof UsgsError ? error.code : "UPSTREAM_UNAVAILABLE";
      response.status(code === "RESULT_LIMIT_EXCEEDED" ? 422 : 502).json({ error: {
        code,
        message: code === "RESULT_LIMIT_EXCEEDED"
          ? "More than 5,000 earthquakes match these filters. Narrow the time or magnitude range."
          : "Couldn't load earthquake data from USGS. Please try again.",
      } } satisfies ApiError);
    }
  });
  return app;
}
