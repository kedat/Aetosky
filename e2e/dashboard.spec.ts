import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const upstream = "http://127.0.0.1:4912";
const api = "http://127.0.0.1:4911";
const scope = (page: Page) => page.getByRole("region", { name: "Displayed data scope" });
const markers = (page: Page) => page.locator(".earthquake-marker");
async function control(request: APIRequestContext, mode = "normal", delayMs = 0) {
  await request.post(`${upstream}/__test/control`, { data: { mode, delayMs, clear: false } });
}
async function openFilters(page: Page) {
  if (!await page.locator(".filter-disclosure").evaluate(element => (element as HTMLDetailsElement).open)) await page.locator(".filter-disclosure > summary").click();
}
async function load(page: Page) {
  await page.goto("/"); await expect(page.locator(".count-cell strong")).toHaveText("8");
  await expect(markers(page)).toHaveCount(8);
}
async function apply(page: Page) {
  const response = page.waitForResponse(response => response.url().includes("/api/earthquakes") && response.request().method() === "GET");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  return response;
}
async function pan(page: Page) {
  const pane = page.locator(".leaflet-map-pane"); const before = await pane.getAttribute("style");
  await page.locator(".earthquake-map").focus(); await page.keyboard.press("ArrowRight");
  await expect(pane).not.toHaveAttribute("style", before!);
  await expect(pane).not.toHaveClass(/leaflet-pan-anim/);
}
async function selectMarker(page: Page, id = "europe") {
  const marker = page.locator(`[data-earthquake-id="${id}"]`);
  await marker.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".event-details")).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${upstream}/__test/control`, { data: { mode: "normal" } });
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64") }));
  await page.route(/https:\/\/(fonts.googleapis.com|fonts.gstatic.com)\//, route => route.abort());
});

test("overview, keyboard details, closing, and panning preserve scope without fetching", async ({ page, request }, info) => {
  await load(page);
  await expect(scope(page)).toContainText("Worldwide"); await expect(scope(page)).toContainText("All reported magnitudes");
  await expect(page.locator(".time-range time").first()).toHaveAttribute("datetime", "2026-10-24T09:00:00.000Z");
  const before = await scope(page).innerText();
  await selectMarker(page); await expect(page.getByRole("heading", { name: "Central overview event" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View event on USGS" })).toHaveAttribute("href", /eventpage\/europe$/);
  await page.keyboard.press("Escape"); await expect(page.locator(".event-details")).toHaveCount(0);
  await expect(page.locator('[data-earthquake-id="europe"]')).toBeFocused();
  await pan(page); expect(await scope(page).innerText()).toBe(before);
  const calls = await (await request.get(`${upstream}/__test/requests`)).json(); expect(calls).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("overview.png"), fullPage: true });
});

for (const [name, area, time, magnitude] of [
  ["area", true, false, false], ["time", false, true, false], ["magnitude", false, false, true],
  ["area + time", true, true, false], ["area + magnitude", true, false, true], ["time + magnitude", false, true, true],
  ["area + time + magnitude", true, true, true],
] as const) {
  test(`Apply supports ${name} independently and atomically`, async ({ page, request }) => {
    await load(page); const before = await scope(page).innerText();
    if (area) {
      await page.getByRole("button", { name: "Zoom in" }).click();
      await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
      await openFilters(page); await page.getByRole("button", { name: "Use current map bounds" }).click();
      const captured = await page.getByLabel("Pending area").innerText();
      await pan(page); await expect(page.getByLabel("Pending area")).toHaveText(captured);
    }
    await openFilters(page);
    if (time) await page.getByLabel("Time range", { exact: true }).selectOption("past-7-days");
    if (magnitude) { await page.getByLabel("Minimum magnitude", { exact: true }).fill("4"); await page.getByLabel("Maximum magnitude", { exact: true }).fill("6"); }
    expect(await scope(page).innerText()).toBe(before);
    const callsBefore = await (await request.get(`${upstream}/__test/requests`)).json(); expect(callsBefore).toHaveLength(1);
    const response = await apply(page); expect(response.status()).toBe(200);
    const body = await response.json();
    await expect(page.locator(".count-cell strong")).toHaveText(String(body.count)); await expect(markers(page)).toHaveCount(body.count);
    expect(body.scope.time.preset).toBe(time ? "past-7-days" : "past-24-hours");
    expect(body.scope.magnitude.minimum).toBe(magnitude ? 4 : null);
    expect(typeof body.scope.area === "object").toBe(area);
    if (area) {
      const applied = await scope(page).innerText(); await pan(page); expect(await scope(page).innerText()).toBe(applied);
      await expect(page.locator(".applied-area")).toHaveCount(1);
    }
  });
}

test("clear each filter is staged and Reset restores the overview, camera and details", async ({ page }) => {
  await load(page); const originalCamera = await page.locator(".leaflet-map-pane").getAttribute("style");
  await pan(page); await openFilters(page); await page.getByRole("button", { name: "Use current map bounds" }).click();
  await page.getByLabel("Time range", { exact: true }).selectOption("past-7-days"); await page.getByLabel("Minimum magnitude", { exact: true }).fill("4");
  await apply(page); const applied = await scope(page).innerText();
  await openFilters(page); await page.getByRole("button", { name: "Clear area", exact: true }).click();
  await page.getByRole("button", { name: "Clear magnitude", exact: true }).click(); await page.getByRole("button", { name: "Restore past 24 hours" }).click();
  expect(await scope(page).innerText()).toBe(applied);
  await page.getByRole("button", { name: "Reset overview" }).click();
  await expect(page.locator(".count-cell strong")).toHaveText("8"); await expect(scope(page)).toContainText("Worldwide");
  await expect(scope(page)).toContainText("All reported magnitudes");
  await expect(page.locator(".applied-area, .pending-area, .event-details")).toHaveCount(0);
  await expect(page.locator(".leaflet-map-pane")).toHaveAttribute("style", originalCamera!);
  await openFilters(page); await expect(page.getByLabel("Minimum magnitude", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Time range", { exact: true })).toHaveValue("past-24-hours");
});

test("Reset supersedes an in-flight Apply and old results cannot return later", async ({ page, request }) => {
  await load(page); await control(request, "normal", 900);
  await openFilters(page); await page.getByLabel("Minimum magnitude", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByText(/Updating to/)).toBeVisible();
  await page.getByRole("button", { name: "Reset overview" }).click();
  await expect(page.getByText(/Returning to overview/)).toBeVisible();
  await expect(page.locator(".count-cell strong")).toHaveText("8");
  await expect(page.locator(".request-banner")).toHaveCount(0);
  await expect(scope(page)).toContainText("All reported magnitudes");
  await expect(markers(page)).toHaveCount(8);
});

for (const mode of ["failure", "malformed", "embedded-error", "timeout", "oversized"]) {
  test(`${mode} retains the previous snapshot and Retry uses the submitted filters`, async ({ page, request }) => {
    await load(page); const before = await scope(page).innerText();
    await control(request, mode); await openFilters(page); await page.getByLabel("Minimum magnitude", { exact: true }).fill("4");
    await apply(page); await expect(page.getByRole("alert")).toBeVisible();
    expect(await scope(page).innerText()).toBe(before); await expect(markers(page)).toHaveCount(8);
    await openFilters(page); await page.getByLabel("Minimum magnitude", { exact: true }).fill("5");
    await control(request); await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".request-banner")).toHaveCount(0); await expect(scope(page)).toContainText("M ≥ 4");
    await openFilters(page); await expect(page.getByLabel("Minimum magnitude", { exact: true })).toHaveValue("5");
  });
}

test("a failed Reset retains old scope, then Retry recovers default data", async ({ page, request }) => {
  await load(page); await openFilters(page); await page.getByLabel("Minimum magnitude", { exact: true }).fill("5"); await apply(page);
  const before = await scope(page).innerText(); await selectMarker(page, "greece");
  await control(request, "failure"); await page.getByRole("button", { name: "Reset overview" }).click();
  await expect(page.getByRole("alert")).toBeVisible(); expect(await scope(page).innerText()).toBe(before);
  await expect(page.locator(".event-details")).toHaveCount(0);
  await control(request); await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".count-cell strong")).toHaveText("8"); await expect(scope(page)).toContainText("All reported magnitudes");
});

for (const mode of ["empty", "no-content"]) test(`${mode} is a successful empty scope, not an error`, async ({ page, request }) => {
  await load(page); await control(request, mode); await openFilters(page); await page.getByLabel("Minimum magnitude", { exact: true }).fill("8"); await apply(page);
  await expect(page.locator(".count-cell strong")).toHaveText("0"); await expect(scope(page)).toContainText("M ≥ 8");
  await expect(page.getByText("No earthquakes match the displayed filters.")).toBeVisible(); await expect(page.getByRole("alert")).toHaveCount(0);
  await control(request); await page.getByRole("button", { name: "Reset overview" }).click(); await expect(markers(page)).toHaveCount(8);
});

test("initial loading and failure show no fabricated count and Retry recovers", async ({ page, request }) => {
  await control(request, "failure", 400); await page.goto("/");
  await expect(page.getByText("Loading earthquake activity…")).toBeVisible(); await expect(page.locator(".count-cell strong")).toHaveText("—");
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.locator(".time-range")).toHaveCount(0);
  await control(request); await page.getByRole("button", { name: "Retry", exact: true }).click(); await expect(markers(page)).toHaveCount(8);
});

test("invalid values never fetch, and local dates become explicit UTC", async ({ page, request }) => {
  await load(page); await openFilters(page); await page.getByLabel("Minimum magnitude", { exact: true }).fill("NaN");
  await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeDisabled();
  await page.getByLabel("Minimum magnitude", { exact: true }).fill("6"); await page.getByLabel("Maximum magnitude", { exact: true }).fill("4");
  await expect(page.getByText("Maximum must be greater than or equal to minimum.")).toBeVisible();
  const calls = await (await request.get(`${upstream}/__test/requests`)).json(); expect(calls).toHaveLength(1);
  await page.getByRole("button", { name: "Clear magnitude", exact: true }).click(); await page.getByLabel("Time range", { exact: true }).selectOption("custom");
  await page.getByLabel("Start date and time").fill("2026-10-24T07:00"); await page.getByLabel("End date and time").fill("2026-10-25T16:00");
  const result = await (await apply(page)).json(); expect(result.scope.time.start).toBe("2026-10-24T00:00:00.000Z"); expect(result.scope.time.end).toBe("2026-10-25T09:00:00.000Z");
});

test("date-line and wrapped bounds return both sides with all filters", async ({ request }) => {
  const response = await request.get(`${api}/api/earthquakes?preset=past-7-days&minlatitude=-30&maxlatitude=0&minlongitude=170&maxlongitude=-170&minmagnitude=4&maxmagnitude=6`);
  expect(response.status()).toBe(200); const body = await response.json(); expect(body.count).toBe(2);
  expect(body.events.map((event: { id: string }) => event.id).sort()).toEqual(["date-east", "date-west"]);
  expect(body.scope.area.east).toBe(190);
});

test("details reset scroll and keep the mobile map selectable", async ({ page }, info) => {
  await load(page);
  if (!info.project.name.includes("mobile")) await page.setViewportSize({ width: 1440, height: 650 });
  await selectMarker(page); await page.locator(".event-details").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => page.locator(".event-details").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await selectMarker(page, "greece"); await expect(page.locator(".event-details")).toHaveJSProperty("scrollTop", 0);
  await expect(page.getByRole("heading", { name: "Greece event" })).toBeVisible();
  if (info.project.name.includes("mobile")) {
    const map = (await page.locator(".earthquake-map").boundingBox())!, panel = (await page.locator(".event-details").boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(map.y + map.height);
    const available = await page.locator(".earthquake-marker").evaluateAll(elements => elements.filter(element => {
      const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      return y >= 0 && y < innerHeight && document.elementFromPoint(x, y) === element;
    }).length); expect(available).toBeGreaterThan(1);
  }
});

test("tile failures persist after the layer finishes and do not remove earthquake data", async ({ page }) => {
  await page.unroute("https://tile.openstreetmap.org/**"); await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  await load(page); await expect(page.locator(".tile-warning")).toBeVisible();
  await expect.poll(() => page.locator("img.leaflet-tile").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
  await expect(page.locator(".tile-warning")).toBeVisible(); await expect(markers(page)).toHaveCount(8);
});
