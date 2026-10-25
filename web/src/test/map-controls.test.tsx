import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MapControls } from "../MapControls";

const map = vi.hoisted(() => ({ getBounds: vi.fn(), on: vi.fn(), off: vi.fn(), invalidateSize: vi.fn(), getContainer: () => document.createElement("div") }));
vi.mock("react-leaflet", () => ({ useMap: () => map }));

it("ignores zero-size layout bounds and captures the next resize", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const bounds = (south: number, north: number) => ({ getSouth: () => south, getNorth: () => north, getWest: () => -180, getEast: () => 180 });
  map.getBounds.mockReturnValue(bounds(0, 0));
  const onViewportChange = vi.fn();
  const view = render(<MapControls onViewportChange={onViewportChange} />);
  expect(onViewportChange).not.toHaveBeenCalled();
  map.getBounds.mockReturnValue(bounds(-100, 100));
  const update = map.on.mock.calls.at(-1)![1]; update();
  expect(onViewportChange).toHaveBeenCalledWith({ south: -90, north: 90, west: -180, east: 180 });
  view.unmount(); expect(map.off).toHaveBeenCalledWith("moveend zoomend resize", update); vi.unstubAllGlobals();
});
