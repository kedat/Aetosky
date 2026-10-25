import express from "express";
import type { ApiError, OverviewSnapshot } from "@earthquake/shared";
import { loadOverview, UsgsError } from "./usgs.js";

export function createApp(load: () => Promise<OverviewSnapshot> = () => loadOverview()) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/api/earthquakes", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (Object.keys(request.query).length) {
      response.status(400).json({ error: { code: "INVALID_REQUEST", message: "Filters are not supported yet." } } satisfies ApiError);
      return;
    }
    try { response.json(await load()); }
    catch (error) {
      response.status(502).json({ error: { code: error instanceof UsgsError ? error.code : "UPSTREAM_UNAVAILABLE", message: "Couldn't load earthquake data from USGS. Please try again." } } satisfies ApiError);
    }
  });
  return app;
}
