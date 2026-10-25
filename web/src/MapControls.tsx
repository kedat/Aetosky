import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { AreaBounds } from "@earthquake/shared";
import { normalizeArea } from "./area";

export const WORLD_BOUNDS: [[number, number], [number, number]] = [[-60, -180], [75, 180]];

export function MapControls({ onViewportChange, resetVersion = 0 }: { onViewportChange?: (area: AreaBounds) => void; resetVersion?: number }) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const bounds = map.getBounds();
      const area = { south: Math.max(-90, bounds.getSouth()), north: Math.min(90, bounds.getNorth()), west: bounds.getWest(), east: bounds.getEast() };
      // Layout can briefly produce a zero-size viewport; wait for its next resize.
      if (!Object.values(area).every(Number.isFinite) || area.south >= area.north || area.west === area.east) return;
      onViewportChange?.(normalizeArea(area));
    };
    const resize = update;
    map.on("moveend zoomend resize", update); resize();
    return () => { map.off("moveend zoomend resize", update); };
  }, [map, onViewportChange]);
  useEffect(() => {
    if (resetVersion) map.stop().fitBounds(WORLD_BOUNDS, { padding: [12, 12], animate: false });
  }, [map, resetVersion]);
  return null;
}
