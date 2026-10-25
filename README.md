# Earthquake Explorer

A map-first earthquake dashboard using React + TypeScript, Leaflet, and a Node.js + TypeScript API focused on USGS integration.

## Run locally

Requirements: Node.js 24.22.1 and pnpm 10.20.0. On this machine, the existing toolchain is available with:

```sh
export PATH="$PWD/.tools/bin:$PATH"
```

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:5173**. The API listens on port 3001; Vite proxies `/api`. USGS and OpenStreetMap tiles need internet access. No API key is required. Use `pnpm dev:web` and `pnpm dev:server` for separate terminals.

## Explore

The initial view loads real worldwide USGS earthquakes from the past 24 hours, with all reported magnitudes. The scope shows the applied area, magnitude limits, exact time window, time zone, count, and source timestamps.

Pan or zoom freely. To filter geographically, choose **Use current map bounds**. The captured area stays fixed when the map moves. Choose a time preset or custom local dates, and optionally enter either or both magnitude limits. All filters work independently and together. Changes remain pending until **Apply filters**. Applied bounds use a solid outline; changed pending bounds use a dashed outline.

Select a marker with a pointer or keyboard to inspect its retrieved details. Missing optional fields display “Not available.” Inspection does not request additional earthquake data or move the map. On mobile, details appear below the map; filters expand from their summary.

Clear individual filters and Apply to keep the other filters. **Reset overview** clears drafts and details, restores the initial camera, and requests the default overview immediately. Data and scope stay together during loading or failure, including a failed Reset. Retry repeats the failed submission, preserving newer draft edits. Superseded requests cannot replace newer results.

## Automated verification

Install browser binaries once:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" pnpm exec playwright install chromium firefox webkit
```

Then run:

```sh
pnpm check
```

This runs TypeScript checks, 61 backend tests, 36 frontend tests, both production builds, and 69 end-to-end browser cases. Browser projects cover desktop Chromium, WebKit, and a 375 × 812 Chromium mobile viewport. The E2E suite uses the real frontend, proxy, Node API, and Leaflet with a controlled upstream USGS fixture. Map tiles are stubbed for repeatability. It tests independent/combined filters, date-line bounds, staged changes, invalid inputs, empty results, failures, oversized queries, Retry, stale responses, Reset during requests, keyboard details, panel scrolling, mobile layout, and tile-error warnings.

Individual commands:

```sh
pnpm typecheck
pnpm test:server
pnpm test:web
pnpm build
pnpm test:e2e
pnpm test:e2e:report
pnpm test:e2e:firefox # optional additional browser project
```

Firefox coverage is configured separately, but could not run on this machine: its browser process exits before launch with “Could not find profile folder,” including with a canonical temporary directory. It is not included in `pnpm check`; Firefox behavior remains unverified.

For a separate smoke test against **real USGS data and real map tiles**:

```sh
pnpm test:e2e:live
```

The live check covers the overview, combined area/time/magnitude query, event inspection when results exist, Reset, and a date-line query. Counts change naturally. It requires internet access and is kept separate from the deterministic suite. The default HTML report is in ignored `playwright-report/`; live runs have a separate `playwright-live-report/`. Screenshots and failure traces are in `test-results/`. Repeating a suite replaces its previous report.

E2E runs own isolated servers on ports **4910–4912**, leaving development servers alone. Those ports must be free. Test-only control routes exist only in `e2e/server.ts`, not the production API. Browser binaries are automatically loaded from `.tools/playwright-browsers` when that directory exists, otherwise from Playwright's normal cache.

## Manual review

Verification on October 25, 2026: `pnpm check` passed (61 backend tests, 36 frontend tests, both builds, TypeScript checks, and 69 browser cases). `pnpm test:e2e:live` also passed against real USGS data, including the date-line query. Its saved screenshot shows real basemap tiles and a selected event. Firefox launch and physical-device/assistive-technology checks remain outstanding as described above.

1. Open the overview and compare its visible scope with the markers. Pan and zoom without changing that scope.
2. Capture a smaller map area, move the map again, and confirm the captured outline stays fixed. Apply area alone, then combine it with time and magnitude.
3. Edit or clear each filter without Apply; confirm displayed results stay unchanged. Apply and inspect the resulting scope.
4. Select several events, scroll details, and close/reopen them. Check the mobile layout and keyboard navigation.
5. Use browser throttling or block `/api/earthquakes` to inspect loading and failure retention. Retry, then Reset. Block tile requests separately to inspect the basemap warning.
6. Review on your actual phone and with any assistive technology you use. Browser emulation and Playwright WebKit do not replace physical-device or Safari testing.

## Data integration

`GET /api/earthquakes` returns an atomic snapshot: normalized `events`, `count`, applied `scope`, and USGS `source` metadata. The unrestricted default uses the USGS past-day feed. Filtered requests use the catalog count/query endpoints with identical parameters and a **5,000-event cap**. Oversized results are rejected rather than truncated. The cap applies to custom searches.

Supported parameters:

- `preset`: `past-24-hours` (default), `past-7-days`, or `custom`.
- `starttime` and `endtime`: required for custom time, with explicit UTC offsets.
- `minmagnitude` and `maxmagnitude`: independently optional, inclusive; blank means unrestricted. Zero, negative values, and equal bounds are supported.
- `minlatitude`, `maxlatitude`, `minlongitude`, `maxlongitude`: all four required together. Bounds are normalized across wrapped world copies and the international date line.

Relative periods resolve once per request. Custom UI dates use the displayed local time zone and are serialized as UTC. Numeric magnitude limits exclude unknown magnitudes. USGS GeoJSON coordinates are longitude, latitude, depth; Leaflet receives latitude, longitude. Missing optional fields remain null. Malformed required data fails retrieval rather than silently producing partial results. HTTP 204 is a valid empty result. Invalid input returns 400, excessive results 422, and upstream failures 502.

The upstream request has a shared 15-second timeout; the browser has a 20-second deadline. Client disconnection cancels upstream work. Error messages, empty results, and tile failures are distinct states. There is no polling. Reset requests a new default snapshot; USGS caching may return the same feed generation time.

Examples while the API is running:

```sh
curl --fail 'http://localhost:3001/api/earthquakes'
curl --fail 'http://localhost:3001/api/earthquakes?preset=past-7-days&minmagnitude=4&maxmagnitude=6'
curl --fail 'http://localhost:3001/api/earthquakes?minlatitude=-60&maxlatitude=65&minlongitude=170&maxlongitude=190&minmagnitude=4'
```

## Project structure and deployment boundary

- `shared/`: shared API types.
- `server/src/`: query validation, normalization, USGS integration, and HTTP API.
- `web/src/`: React map, filters, scope, details, and request state.
- `server/test/`, `web/src/test/`: focused automated checks.
- `e2e/`: controlled full-stack browser tests and opt-in live smoke test.

After `pnpm build`, `pnpm start:server` runs the compiled API. Hosting the frontend static assets and configuring production routing remain deployment work. No site has been published.

The local basemap uses attributed OpenStreetMap standard tiles. Choose a suitable provider before production deployment and follow its usage policy. An alternative tile URL can be supplied through `VITE_TILE_URL`; update attribution in `web/src/EarthquakeMap.tsx` as appropriate. Place search, radius selection, clustering, and extra data sources remain outside this implementation.

References: [USGS GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), [USGS catalog](https://earthquake.usgs.gov/fdsnws/event/1/), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).
