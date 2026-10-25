import { test, expect } from "@playwright/test";

test("real USGS overview, area/time/magnitude search, inspection, and Reset", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const response = page.waitForResponse(response => response.url().includes("/api/earthquakes"));
  await page.goto("/"); const initial = await response; expect(initial.status()).toBe(200);
  const first = await initial.json(); expect(first.scope.area).toBe("worldwide"); expect(first.count).toBe(first.events.length);
  await expect(page.locator(".count-cell strong")).not.toHaveText("—");
  await page.getByRole("button", { name: "Use current map bounds" }).click();
  await page.getByLabel("Time range", { exact: true }).selectOption("past-7-days");
  await page.getByLabel("Minimum magnitude", { exact: true }).fill("4"); await page.getByLabel("Maximum magnitude", { exact: true }).fill("6");
  const searched = page.waitForResponse(response => response.url().includes("minlatitude="));
  await page.getByRole("button", { name: "Apply filters", exact: true }).click(); const filteredResponse = await searched; expect(filteredResponse.status()).toBe(200);
  const body = await filteredResponse.json(); expect(body.events.every((event: { magnitude: number | null }) => event.magnitude !== null && event.magnitude >= 4 && event.magnitude <= 6)).toBe(true);
  await expect(page.locator(".count-cell strong")).toHaveText(body.count.toLocaleString("en-GB"));
  if (body.count) {
    await page.locator(".earthquake-marker").first().focus(); await page.keyboard.press("Enter"); await expect(page.locator(".event-details")).toBeVisible();
    await page.screenshot({ path: info.outputPath("live-dashboard.png"), fullPage: true });
  }
  const reset = page.waitForResponse(response => response.url().endsWith("/api/earthquakes"));
  await page.getByRole("button", { name: "Reset overview" }).click(); expect((await reset).status()).toBe(200);
  await expect(page.locator(".request-banner")).toHaveCount(0, { timeout: 25000 }); await expect(page.locator(".event-details")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Displayed data scope" })).toContainText("Worldwide");
  const dateLine = await request.get("/api/earthquakes?preset=past-7-days&minlatitude=-60&maxlatitude=65&minlongitude=170&maxlongitude=190&minmagnitude=4");
  expect(dateLine.status()).toBe(200); const dateData = await dateLine.json();
  expect(dateData.events.every((event: { longitude: number }) => event.longitude >= 170 || event.longitude <= -170)).toBe(true);
});
