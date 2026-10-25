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
    let fitted = false;
    const resize = () => {
      map.invalidateSize({ pan: false, animate: false });
      const container = map.getContainer();
      if (!fitted && container.clientWidth > 0 && container.clientHeight > 0) {
        fitted = true;
        map.fitBounds(WORLD_BOUNDS, { padding: [12, 12], animate: false });
      }
      update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(map.getContainer());
    map.on("moveend zoomend resize", update); resize();
    return () => { observer.disconnect(); map.off("moveend zoomend resize", update); };
  }, [map, onViewportChange]);
  useEffect(() => {
    if (resetVersion) map.stop().fitBounds(WORLD_BOUNDS, { padding: [12, 12], animate: false });
  }, [map, resetVersion]);
  return null;
}
