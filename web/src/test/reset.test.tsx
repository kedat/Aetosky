import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OverviewSnapshot } from "@earthquake/shared";
import { useEarthquakes } from "../useEarthquakes";
import { normalizeArea, sameArea } from "../area";
import { sameFilters } from "../magnitudeRange";

const initial: OverviewSnapshot = { events: [], count: 0, scope: { area: "worldwide", time: { preset: "past-24-hours", start: "2026-10-24T09:00:00.000Z", end: "2026-10-25T09:00:00.000Z" }, magnitude: { minimum: null, maximum: null } }, source: { name: "USGS", url: "https://earthquake.usgs.gov", generatedAt: null, retrievedAt: "2026-10-25T09:00:00.000Z" } };
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; }); return { promise, resolve };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("normalizes captured area independently and includes it in draft equality", () => {
  const area = normalizeArea({ south: -30, north: 0, west: 170, east: -170 });
  expect(area.east).toBe(190);
  expect(sameArea(area, { ...area })).toBe(true);
  expect(sameFilters({ preset: "past-24-hours", area }, { preset: "past-24-hours" })).toBe(false);
  expect(sameFilters({ preset: "past-24-hours", area }, { preset: "past-24-hours", area: { ...area } })).toBe(true);
});

it("Reset wins over late responses even when mocked transport ignores abort", async () => {
  const stale = deferred();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(Response.json(initial));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useEarthquakes); await waitFor(() => expect(result.current.state.status).toBe("ready"));
  act(() => { void result.current.request({ preset: "past-7-days" }); });
  await act(async () => result.current.request({ preset: "past-24-hours" }, "reset"));
  expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);
  await act(async () => stale.resolve(Response.json({ ...initial, scope: { ...initial.scope, time: { ...initial.scope.time, preset: "past-7-days" } } })));
  expect(result.current.state.intent).toBe("reset"); expect(result.current.state.snapshot).toEqual(initial);
});

it("copies captured bounds into a request and rejects a mismatched response area", async () => {
  const pending = deferred();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(pending.promise);
  vi.stubGlobal("fetch", fetcher); const { result } = renderHook(useEarthquakes);
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  const area = { south: -30, north: 0, west: 170, east: 190 };
  act(() => { void result.current.request({ preset: "past-24-hours", area }); });
  area.east = 200;
  const url = new URL(fetcher.mock.calls[1]![0], "http://localhost"); expect(url.searchParams.get("maxlongitude")).toBe("190");
  await act(async () => pending.resolve(Response.json(initial)));
  expect(result.current.state.status).toBe("error"); expect(result.current.state.snapshot).toEqual(initial);
  expect(result.current.state.requested.area!.east).toBe(190);
});

it("a client deadline exits loading while retaining the last successful snapshot", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
  vi.stubGlobal("fetch", fetcher); const { result } = renderHook(useEarthquakes);
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  vi.useFakeTimers();
  act(() => { void result.current.request({ preset: "past-7-days" }); });
  await act(async () => vi.advanceTimersByTimeAsync(20_001));
  expect(result.current.state.status).toBe("error"); expect(result.current.state.error).toContain("timed out");
  expect(result.current.state.snapshot).toEqual(initial);
});

it("an invalid successful body cannot replace valid results", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json({ ...initial, scope: { ...initial.scope, area: null } }));
  vi.stubGlobal("fetch", fetcher); const { result } = renderHook(useEarthquakes);
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  await act(async () => result.current.request({ preset: "past-24-hours" }, "reset"));
  expect(result.current.state.status).toBe("error"); expect(result.current.state.snapshot).toEqual(initial);
});
