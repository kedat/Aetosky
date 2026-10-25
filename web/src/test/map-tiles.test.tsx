import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { LeafletEventHandlerFnMap, TileErrorEvent } from "leaflet";
import { EarthquakeMap } from "../EarthquakeMap";

const layer = vi.hoisted(() => ({ handlers: {} as LeafletEventHandlerFnMap }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: ({ eventHandlers }: { eventHandlers: LeafletEventHandlerFnMap }) => {
    layer.handlers = eventHandlers;
    return null;
  },
  CircleMarker: () => null,
}));

function emit(name: "tileerror" | "tileload" | "tileunload" | "loading" | "load", tile = document.createElement("img")) {
  act(() => {
    const event = { type: name, tile, error: new Error("Tile blocked") } as TileErrorEvent;
    layer.handlers[name]?.(event);
  });
}

beforeEach(() => {
  layer.handlers = {};
  render(<EarthquakeMap events={[]} selectedId={null} onSelect={() => {}} />);
});

it("keeps the warning after all 24 tiles fail and the layer finishes loading", () => {
  for (let index = 0; index < 24; index++) emit("tileerror");
  emit("load");
  expect(screen.getByRole("status").textContent).toContain("Some map tiles couldn't load");
  // A successful unrelated tile does not repair those failed images.
  emit("tileload");
  emit("loading");
  emit("load");
  expect(screen.getByRole("status")).toBeTruthy();
});

it("clears the warning only after every failed tile recovers", () => {
  const first = document.createElement("img");
  const second = document.createElement("img");
  emit("tileerror", first);
  emit("tileerror", second);
  emit("tileload", first);
  expect(screen.getByRole("status")).toBeTruthy();
  emit("tileload", second);
  expect(screen.queryByRole("status")).toBeNull();
});

it("removes failures for unloaded tiles without clearing remaining failures", () => {
  const first = document.createElement("img");
  const second = document.createElement("img");
  emit("tileerror", first);
  emit("tileerror", second);
  emit("tileunload", document.createElement("img"));
  emit("tileunload", first);
  expect(screen.getByRole("status")).toBeTruthy();
  emit("tileunload", second);
  expect(screen.queryByRole("status")).toBeNull();
});
