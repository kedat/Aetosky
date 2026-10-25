import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { OverviewSnapshot } from "@earthquake/shared";
import type { EarthquakeMapProps } from "../EarthquakeMap";
import { App } from "../App";
import { magnitudeLabel, validateMagnitudeDraft } from "../magnitudeRange";
import { useEarthquakes } from "../useEarthquakes";

vi.mock("../EarthquakeMap", () => ({ EarthquakeMap: ({ events }: EarthquakeMapProps) => <div aria-label="Map">
  {events.map(event => <span key={event.id}>Marker {event.id}</span>)}
</div> }));
const first: OverviewSnapshot = { count: 1,
  events: [{ id: "initial", longitude: 130, latitude: 30, depthKm: 10, magnitude: null, magnitudeType: null, place: null, occurredAt: "2026-10-24T12:00:00.000Z", updatedAt: null, reviewStatus: null, url: null }],
  scope: { area: "worldwide", time: { preset: "past-24-hours", start: "2026-10-24T09:00:00.000Z", end: "2026-10-25T09:00:00.000Z" }, magnitude: { minimum: null, maximum: null } },
  source: { name: "USGS", url: "https://earthquake.usgs.gov", generatedAt: null, retrievedAt: "2026-10-25T09:01:00.000Z" } };
function responseFor(url: string): OverviewSnapshot {
  const query = new URL(url, "http://localhost").searchParams;
  const preset = query.get("preset") ?? "past-24-hours";
  const minimum = query.has("minmagnitude") ? Number(query.get("minmagnitude")) : null;
  const maximum = query.has("maxmagnitude") ? Number(query.get("maxmagnitude")) : null;
  return { ...first, events: [{ ...first.events[0]!, id: "filtered", magnitude: minimum ?? maximum }], scope: { ...first.scope,
    magnitude: { minimum, maximum },
    time: { preset: preset as "past-24-hours" | "past-7-days" | "custom", start: query.get("starttime") ?? first.scope.time.start, end: query.get("endtime") ?? first.scope.time.end },
  } };
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const minimum = (value: string) => change("Minimum magnitude", value);
const maximum = (value: string) => change("Maximum magnitude", value);
const apply = () => screen.getByRole("button", { name: "Apply filters" }) as HTMLButtonElement;
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

it("validates blank, zero, negative, equal, and invalid magnitude values", () => {
  expect(validateMagnitudeDraft({ minimum: "", maximum: " " }).bounds).toEqual({});
  expect(validateMagnitudeDraft({ minimum: "-0.5", maximum: "0" }).bounds).toEqual({ minMagnitude: -0.5, maxMagnitude: 0 });
  expect(validateMagnitudeDraft({ minimum: "0", maximum: "0" }).bounds).toEqual({ minMagnitude: 0, maxMagnitude: 0 });
  for (const value of ["NaN", "Infinity", "abc", "1e309", "0x10"]) expect(validateMagnitudeDraft({ minimum: value, maximum: "" }).bounds).toBeNull();
  expect(validateMagnitudeDraft({ minimum: "6", maximum: "4" }).bounds).toBeNull();
  expect(magnitudeLabel({ minimum: 2.345, maximum: 5.678 })).toBe("M 2.345 to 5.678");
});

it("stages magnitude-only filters including zero, then clears them only after Apply", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("?") ? responseFor(url) : first));
  vi.stubGlobal("fetch", fetcher); const user = userEvent.setup(); render(<App />);
  await screen.findByText("Marker initial");
  const scope = screen.getByRole("region", { name: "Displayed data scope" });
  minimum("0"); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(scope.textContent).toContain("All reported magnitudes");
  await user.click(apply()); await screen.findByText("Marker filtered");
  expect(scope.textContent).toContain("M ≥ 0");
  expect(new URL(fetcher.mock.calls[1]![0], "http://localhost").searchParams.get("minmagnitude")).toBe("0");
  expect((screen.getByLabelText("Time range") as HTMLSelectElement).value).toBe("past-24-hours");
  minimum(""); maximum("0"); await user.click(apply());
  await waitFor(() => expect(scope.textContent).toContain("M ≤ 0"));
  minimum("0"); await user.click(apply());
  await waitFor(() => expect(scope.textContent).toContain("MAGNITUDEM 0"));
  minimum(""); maximum(""); expect(scope.textContent).toContain("MAGNITUDEM 0");
  await user.click(apply()); await screen.findByText("Marker initial");
  expect(scope.textContent).toContain("All reported magnitudes");
  expect(fetcher.mock.calls.at(-1)![0]).toBe("/api/earthquakes");
});

it("combines magnitude and time in one request without resetting either dimension", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("?") ? responseFor(url) : first));
  vi.stubGlobal("fetch", fetcher); const user = userEvent.setup(); render(<App />);
  await screen.findByText("Marker initial");
  minimum("4"); maximum("6"); await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await user.click(apply()); await screen.findByText("Marker filtered");
  let url = new URL(fetcher.mock.calls.at(-1)![0], "http://localhost");
  expect(url.searchParams.get("preset")).toBe("past-7-days");
  expect(url.searchParams.get("minmagnitude")).toBe("4"); expect(url.searchParams.get("maxmagnitude")).toBe("6");
  await user.selectOptions(screen.getByLabelText("Time range"), "custom");
  change("Start date and time", "2026-10-23T07:00"); change("End date and time", "2026-10-24T07:00");
  await user.click(apply()); await waitFor(() => expect(apply().disabled).toBe(true));
  url = new URL(fetcher.mock.calls.at(-1)![0], "http://localhost");
  expect(url.searchParams.get("starttime")).toBe(new Date(2026, 9, 23, 7).toISOString());
  expect(url.searchParams.get("minmagnitude")).toBe("4"); expect(url.searchParams.get("maxmagnitude")).toBe("6");
  minimum(""); await user.click(apply()); await waitFor(() => expect(apply().disabled).toBe(true));
  url = new URL(fetcher.mock.calls.at(-1)![0], "http://localhost");
  expect(url.searchParams.get("preset")).toBe("custom"); expect(url.searchParams.has("minmagnitude")).toBe(false); expect(url.searchParams.get("maxmagnitude")).toBe("6");
});

it("blocks invalid text and reversed ranges before a request", async () => {
  const fetcher = vi.fn(async () => Response.json(first)); vi.stubGlobal("fetch", fetcher);
  render(<App />); await screen.findByText("Marker initial");
  minimum("Infinity"); expect(screen.getByText("Enter a finite number.")).toBeTruthy(); expect(apply().disabled).toBe(true);
  minimum("6"); maximum("4"); expect(screen.getByText("Maximum must be greater than or equal to minimum.")).toBeTruthy();
  fireEvent.submit(screen.getByRole("form", { name: "Earthquake filters" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("preserves snapshots on failure and submits saved magnitude bounds on Retry despite newer edits", async () => {
  const pending = deferred();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Unavailable" } }, { status: 502 }))
    .mockImplementationOnce(async (url: string) => Response.json(responseFor(url)));
  vi.stubGlobal("fetch", fetcher); const user = userEvent.setup(); render(<App />);
  await screen.findByText("Marker initial");
  minimum("3"); await user.click(apply());
  minimum("4"); maximum("5"); await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  const scope = screen.getByRole("region", { name: "Displayed data scope" });
  expect(scope.textContent).toContain("All reported magnitudes");
  await act(async () => pending.resolve(Response.json(responseFor(fetcher.mock.calls[1]![0]))));
  expect(scope.textContent).toContain("M ≥ 3"); expect((screen.getByLabelText("Minimum magnitude") as HTMLInputElement).value).toBe("4");
  const retainedScope = scope.textContent;
  await user.click(apply()); await screen.findByRole("alert");
  expect(scope.textContent).toBe(retainedScope); expect(screen.getByText("Marker filtered")).toBeTruthy();
  minimum("6"); await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(scope.textContent).toContain("M 4 to 5"));
  expect(fetcher.mock.calls[3]![0]).toBe(fetcher.mock.calls[2]![0]);
  expect((screen.getByLabelText("Minimum magnitude") as HTMLInputElement).value).toBe("6"); expect(apply().disabled).toBe(true);
});

it("rejects a response with different magnitude scope instead of relabeling old data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(first)));
  const { result } = renderHook(useEarthquakes); await waitFor(() => expect(result.current.state.status).toBe("ready"));
  await act(async () => result.current.request({ preset: "past-24-hours", minMagnitude: 4 }));
  expect(result.current.state.status).toBe("error"); expect(result.current.state.snapshot).toEqual(first);
});

it("ignores a late magnitude response even when both searches share the same time preset", async () => {
  const stale = deferred(); const latest = deferred();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(first)).mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise));
  const { result } = renderHook(useEarthquakes); await waitFor(() => expect(result.current.state.status).toBe("ready"));
  act(() => { void result.current.request({ preset: "past-24-hours", minMagnitude: 3 }); });
  act(() => { void result.current.request({ preset: "past-24-hours", minMagnitude: 4 }); });
  await act(async () => latest.resolve(Response.json(responseFor("/api/earthquakes?preset=past-24-hours&minmagnitude=4"))));
  await act(async () => stale.resolve(Response.json(responseFor("/api/earthquakes?preset=past-24-hours&minmagnitude=3"))));
  expect(result.current.state.snapshot!.scope.magnitude.minimum).toBe(4);
});
