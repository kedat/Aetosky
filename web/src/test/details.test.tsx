import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Earthquake, OverviewSnapshot } from "@earthquake/shared";
import type { EarthquakeMapProps } from "../EarthquakeMap";
import { App } from "../App";
import { EventDetails } from "../EventDetails";

// The browser smoke check exercises actual Leaflet markers; these tests isolate
// React selection and snapshot behavior from map layout and network tiles.
vi.mock("../EarthquakeMap", () => ({
  EarthquakeMap: ({ events, selectedId, onSelect }: EarthquakeMapProps) => <div aria-label="Map">
    {events.map(event => <button key={event.id} aria-pressed={event.id === selectedId} onClick={() => onSelect(event.id)}>
      Select {event.id}
    </button>)}
  </div>,
}));

const first: Earthquake = {
  id: "first", longitude: 131.873, latitude: 31.8226, depthKm: 10, magnitude: 5.3, magnitudeType: "mb",
  place: "Near Miyazaki, Japan", occurredAt: "2026-10-25T08:00:00.000Z", updatedAt: "2026-10-25T08:10:00.000Z",
  reviewStatus: "reviewed", url: "https://earthquake.usgs.gov/earthquakes/eventpage/first",
};
const second: Earthquake = { ...first, id: "second", place: "Near Anchorage, Alaska", magnitude: 0, depthKm: 0, latitude: 0, longitude: 0 };
const snapshot: OverviewSnapshot = {
  events: [first, second], count: 2,
  scope: { area: "worldwide", time: { preset: "past-24-hours", start: "2026-10-24T09:00:00.000Z", end: "2026-10-25T09:00:00.000Z" }, magnitude: { minimum: null, maximum: null } },
  source: { name: "USGS", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", generatedAt: "2026-10-25T09:00:00.000Z", retrievedAt: "2026-10-25T09:01:00.000Z" },
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => Response.json(snapshot))));
afterEach(() => vi.unstubAllGlobals());

describe("event selection", () => {
  it("opens and replaces details, highlights one marker, and closes without refetching or changing scope", async () => {
    const user = userEvent.setup();
    render(<App />);
    const firstMarker = await screen.findByRole("button", { name: "Select first" });
    const secondMarker = screen.getByRole("button", { name: "Select second" });
    const scope = screen.getByRole("region", { name: "Displayed data scope" });
    const initialScope = scope.textContent;
    expect(screen.queryByRole("complementary")).toBeNull();

    await user.click(firstMarker);
    expect(screen.getByRole("complementary", { name: first.place! })).toBeTruthy();
    expect(firstMarker.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: first.place! })).toBe(document.activeElement);

    await user.click(secondMarker);
    const panel = screen.getByRole("complementary", { name: second.place! });
    expect(screen.queryByRole("heading", { name: first.place! })).toBeNull();
    expect(within(panel).getByText("M 0.0")).toBeTruthy();
    expect(firstMarker.getAttribute("aria-pressed")).toBe("false");
    expect(secondMarker.getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Close earthquake details" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(secondMarker.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(secondMarker);
    expect(scope.textContent).toBe(initialScope);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("Escape closes details and restores focus to the selected marker", async () => {
    const user = userEvent.setup();
    render(<App />);
    const marker = await screen.findByRole("button", { name: "Select first" });
    await user.click(marker);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(marker);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("detail fields", () => {
  it("resets panel scroll only when switching to a different event", () => {
    const onClose = () => {};
    const { rerender } = render(<EventDetails event={first} onClose={onClose} />);
    const panel = screen.getByRole("complementary");
    panel.scrollTop = 200;
    rerender(<EventDetails event={{ ...first, magnitude: 5.4 }} onClose={onClose} />);
    expect(panel.scrollTop).toBe(200);
    rerender(<EventDetails event={second} onClose={onClose} />);
    expect(panel.scrollTop).toBe(0);
    expect(screen.getByRole("heading", { name: second.place! })).toBe(document.activeElement);
  });

  it("shows core fields and the actual USGS event link", () => {
    render(<EventDetails event={first} onClose={() => {}} />);
    expect(screen.getByText("M 5.3")).toBeTruthy();
    expect(screen.getByText("mb")).toBeTruthy();
    expect(screen.getByText("10 km")).toBeTruthy();
    expect(screen.getByText("reviewed")).toBeTruthy();
    expect(screen.getByText("Coordinates", { exact: false }).nextElementSibling?.textContent).toBe("31.8226° N / 131.8730° E");
    expect(screen.getByText("Occurred", { exact: false }).nextElementSibling?.textContent).not.toBe("Not available");
    expect(screen.getByText("Last updated", { exact: false }).nextElementSibling?.textContent).not.toBe("Not available");
    expect(screen.getByRole("link", { name: "View event on USGS" }).getAttribute("href")).toBe(first.url);
  });

  it("retains zero magnitudes, depths, and coordinates", () => {
    render(<EventDetails event={second} onClose={() => {}} />);
    expect(screen.getByText("M 0.0")).toBeTruthy();
    expect(screen.getByText("0 km")).toBeTruthy();
    expect(screen.getByText("Coordinates", { exact: false }).nextElementSibling?.textContent).toBe("0.0000° N / 0.0000° E");
  });

  it("retains negative magnitude/depth and correctly labels southern and western coordinates", () => {
    render(<EventDetails event={{ ...first, magnitude: -0.3, depthKm: -1.42, latitude: -12.5, longitude: -170.25 }} onClose={() => {}} />);
    expect(screen.getByText("M -0.3")).toBeTruthy();
    expect(screen.getByText("-1.42 km")).toBeTruthy();
    expect(screen.getByText("Coordinates", { exact: false }).nextElementSibling?.textContent).toBe("12.5000° S / 170.2500° W");
  });

  it("labels missing fields without inventing values or a source link", () => {
    render(<EventDetails event={{ ...first, magnitude: null, magnitudeType: null, depthKm: null, place: null, updatedAt: null, reviewStatus: null, url: null }} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Location not available" })).toBeTruthy();
    expect(screen.getAllByText("Not available").length).toBe(5);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("M 0.0")).toBeNull();
  });

  it.each(["javascript:alert(1)", "https://example.com/event", "not a URL"])("does not expose an invalid USGS link: %s", url => {
    render(<EventDetails event={{ ...first, url }} onClose={() => {}} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("USGS event link: Not available")).toBeTruthy();
  });
});
