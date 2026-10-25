import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Earthquake, OverviewSnapshot } from "@earthquake/shared";
import type { EarthquakeMapProps } from "../EarthquakeMap";
import { App } from "../App";
import { useEarthquakes } from "../useEarthquakes";
import { validateTimeDraft } from "../timeRange";

vi.mock("../EarthquakeMap", () => ({
  EarthquakeMap: ({ events, onSelect }: EarthquakeMapProps) => <div aria-label="Map">
    {events.map(event => <button key={event.id} onClick={() => onSelect(event.id)}>Select {event.id}</button>)}
  </div>,
}));

const event: Earthquake = { id: "overview", longitude: 130, latitude: 30, depthKm: 10, magnitude: 3, magnitudeType: "mb", place: "Overview location",
  occurredAt: "2026-10-24T12:00:00.000Z", updatedAt: null, reviewStatus: null, url: null };
const initial: OverviewSnapshot = { events: [event], count: 1,
  scope: { area: "worldwide", time: { preset: "past-24-hours", start: "2026-10-24T09:00:00.000Z", end: "2026-10-25T09:00:00.000Z" }, magnitude: { minimum: null, maximum: null } },
  source: { name: "USGS", url: "https://earthquake.usgs.gov", generatedAt: "2026-10-25T09:00:00.000Z", retrievedAt: "2026-10-25T09:01:00.000Z" } };
const week: OverviewSnapshot = { ...initial, events: [{ ...event, id: "week", place: "Week location" }],
  scope: { ...initial.scope, time: { preset: "past-7-days", start: "2026-10-18T09:00:00.000Z", end: "2026-10-25T09:00:00.000Z" } } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function customSnapshot(url: string): OverviewSnapshot {
  const query = new URL(url, "http://localhost").searchParams;
  return { ...initial, events: [{ ...event, id: "custom" }], scope: { ...initial.scope, time: { preset: "custom", start: query.get("starttime")!, end: query.get("endtime")! } } };
}
function customFields(start = "2026-10-23T07:00", end = "2026-10-24T07:00") {
  fireEvent.change(screen.getByLabelText("Start date and time"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("End date and time"), { target: { value: end } });
}
afterEach(() => vi.unstubAllGlobals());

it("stages a time preset without fetching and commits results/scope together only on success", async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(pending.promise);
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "Select overview" });
  const scope = screen.getByRole("region", { name: "Displayed data scope" });
  const originalScope = scope.textContent;
  await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Pending changes")).toBeTruthy();
  expect(scope.textContent).toBe(originalScope);
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByRole("button", { name: "Select overview" })).toBeTruthy();
  expect(scope.textContent).toBe(originalScope);
  expect((screen.getByRole("button", { name: "Apply filters" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => pending.resolve(Response.json(week)));
  expect(screen.getByRole("button", { name: "Select week" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select overview" })).toBeNull();
  expect(scope.textContent).not.toBe(originalScope);
  expect(document.querySelector(".period-badge")?.textContent).toContain("Past 7 days");
});

it("converts local custom dates to explicit UTC request parameters", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("?") ? customSnapshot(url) : initial));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup(); render(<App />);
  await screen.findByRole("button", { name: "Select overview" });
  await user.selectOptions(screen.getByLabelText("Time range"), "custom");
  customFields();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await screen.findByRole("button", { name: "Select custom" });
  const url = new URL(fetcher.mock.calls[1]![0], "http://localhost");
  expect(url.searchParams.get("starttime")).toBe(new Date(2026, 9, 23, 7, 0).toISOString());
  expect(url.searchParams.get("endtime")).toBe(new Date(2026, 9, 24, 7, 0).toISOString());
  expect(url.searchParams.get("preset")).toBe("custom");
});

it("keeps the last snapshot, details, and draft on failure; Retry repeats the failed request", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial))
    .mockResolvedValueOnce(Response.json({ error: { code: "RESULT_LIMIT_EXCEEDED", message: "More than 5,000 earthquakes match this time range. Choose a shorter range." } }, { status: 422 }))
    .mockResolvedValueOnce(Response.json(week));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole("button", { name: "Select overview" }));
  const scope = screen.getByRole("region", { name: "Displayed data scope" });
  const originalScope = scope.textContent;
  await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await screen.findByRole("alert");
  expect(scope.textContent).toBe(originalScope);
  expect(screen.getByRole("heading", { name: "Overview location" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("5,000");
  expect((screen.getByLabelText("Time range") as HTMLSelectElement).value).toBe("past-7-days");
  await user.selectOptions(screen.getByLabelText("Time range"), "custom"); customFields();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Select week" });
  expect(fetcher.mock.calls[2]![0]).toBe(fetcher.mock.calls[1]![0]);
  expect((screen.getByLabelText("Time range") as HTMLSelectElement).value).toBe("custom");
  expect(screen.getByText("Pending changes")).toBeTruthy();
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("does not let draft edits during loading change the submitted request or its applied label", async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(pending.promise);
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup(); render(<App />);
  await screen.findByRole("button", { name: "Select overview" });
  await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await user.selectOptions(screen.getByLabelText("Time range"), "custom"); customFields();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(Response.json(week)));
  expect(document.querySelector(".period-badge")?.textContent).toContain("Past 7 days");
  expect((screen.getByLabelText("Time range") as HTMLSelectElement).value).toBe("custom");
  expect(screen.getByText("Pending changes")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Apply filters" }) as HTMLButtonElement).disabled).toBe(false);
  await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  expect((screen.getByRole("button", { name: "Apply filters" }) as HTMLButtonElement).disabled).toBe(true);
});

it("blocks invalid custom ranges before any request", async () => {
  const fetcher = vi.fn(async () => Response.json(initial)); vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup(); render(<App />);
  await screen.findByRole("button", { name: "Select overview" });
  await user.selectOptions(screen.getByLabelText("Time range"), "custom");
  customFields("2026-10-25T07:00", "2026-10-24T07:00");
  expect(screen.getByText("End time must be after start time.")).toBeTruthy();
  expect(screen.getByLabelText("End date and time").getAttribute("aria-invalid")).toBe("true");
  expect((screen.getByRole("button", { name: "Apply filters" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole("form", { name: "Earthquake filters" }));
  customFields("", "2026-10-24T07:00");
  expect(screen.getByText("Enter a valid start date and time.")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects impossible calendar dates, equal endpoints, and incomplete local values", () => {
  for (const [start, end] of [["2026-02-30T12:00", "2026-03-02T12:00"], ["2026-10-24T12:00", "2026-10-24T12:00"], ["", "2026-10-24T12:00"]]) {
    expect(validateTimeDraft({ preset: "custom", start: start!, end: end! }).request).toBeNull();
  }
});

it("commits empty success with its new scope instead of retaining old markers", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json({ ...week, events: [], count: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup(); render(<App />);
  await screen.findByRole("button", { name: "Select overview" });
  await user.selectOptions(screen.getByLabelText("Time range"), "past-7-days");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await screen.findByText("No earthquakes match the displayed filters.");
  expect(screen.queryByRole("button", { name: "Select overview" })).toBeNull();
  expect(document.querySelector(".count-cell strong")?.textContent).toBe("0");
  expect(document.querySelector(".period-badge")?.textContent).toContain("Past 7 days");
});

it.each(["success", "failure"])("ignores an obsolete request's late %s even if transport ignores cancellation", async outcome => {
  const obsolete = deferred<Response>();
  const latest = deferred<Response>();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(latest.promise);
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useEarthquakes);
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  act(() => { void result.current.request({ preset: "past-7-days" }); });
  const custom = { preset: "custom", start: "2026-10-23T00:00:00.000Z", end: "2026-10-24T00:00:00.000Z" } as const;
  act(() => { void result.current.request(custom); });
  expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);
  await act(async () => latest.resolve(Response.json({ ...initial, events: [{ ...event, id: "latest" }], scope: { ...initial.scope, time: custom } })));
  expect(result.current.state.snapshot!.events[0]!.id).toBe("latest");
  await act(async () => { if (outcome === "success") obsolete.resolve(Response.json(week)); else obsolete.reject(new Error("late failure")); });
  expect(result.current.state.status).toBe("ready");
  expect(result.current.state.snapshot!.events[0]!.id).toBe("latest");
  expect(result.current.state.applied).toEqual(custom);
});

it("keeps the prior snapshot when the response scope does not match the requested window", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json(initial));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useEarthquakes);
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  await act(async () => result.current.request({ preset: "past-7-days" }));
  expect(result.current.state.status).toBe("error");
  expect(result.current.state.snapshot).toEqual(initial);
  expect(result.current.state.applied).toEqual({ preset: "past-24-hours" });
});
