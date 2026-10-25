import { useEffect, useMemo, useRef, useState } from "react";
import { SVG } from "leaflet";
import type { CircleMarker as LeafletCircleMarker, TileEvent } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, Rectangle } from "react-leaflet";
import type { Earthquake, AreaBounds } from "@earthquake/shared";
import { magnitudeFormat } from "./formatting";
import { MapControls, WORLD_BOUNDS } from "./MapControls";
import { sameArea } from "./area";

export interface EarthquakeMapProps {
  events: Earthquake[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onViewportChange?: (area: AreaBounds) => void;
  draftArea?: AreaBounds | null;
  appliedArea?: AreaBounds | null;
}

function EarthquakeMarker({ event, selected, onSelect }: { event: Earthquake; selected: boolean; onSelect: (id: string) => void }) {
  const marker = useRef<LeafletCircleMarker>(null);
  const radius = event.magnitude === null ? 4 : Math.max(3, 3 + Math.max(0, event.magnitude) * 1.6);
  const select = () => {
    const element = marker.current?.getElement();
    if (element instanceof SVGElement) element.focus({ preventScroll: true });
    onSelect(event.id);
  };
  useEffect(() => {
    const element = marker.current?.getElement();
    if (!element) return;
    element.setAttribute("tabindex", "0");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `Magnitude ${event.magnitude === null ? "unknown" : magnitudeFormat.format(event.magnitude)} earthquake: ${event.place ?? "location not available"}`);
    element.setAttribute("aria-pressed", String(selected));
    if (selected) element.setAttribute("aria-controls", "event-details-panel");
    else element.removeAttribute("aria-controls");
    element.setAttribute("data-earthquake-id", event.id);
    const keydown = (key: Event) => {
      if (key instanceof KeyboardEvent && (key.key === "Enter" || key.key === " ")) {
        key.preventDefault();
        key.stopPropagation();
        if (element instanceof SVGElement) element.focus({ preventScroll: true });
        onSelect(event.id);
      }
    };
    element.addEventListener("keydown", keydown);
    if (selected) marker.current?.bringToFront();
    return () => element.removeEventListener("keydown", keydown);
  }, [event, selected, onSelect]);

  return <CircleMarker ref={marker} className="earthquake-marker" center={[event.latitude, event.longitude]} radius={radius + (selected ? 3 : 0)}
    eventHandlers={{ click: select }} bubblingMouseEvents={false}
    pathOptions={{ color: selected ? "#173e52" : event.magnitude === null ? "#64748b" : "#c24c24",
      weight: selected ? 3 : 1.2, fillColor: event.magnitude === null ? "#94a3b8" : "#ef7846", fillOpacity: selected ? 0.95 : 0.65 }} />;
}

export function EarthquakeMap({ events, selectedId, onSelect, onViewportChange, draftArea, appliedArea }: EarthquakeMapProps) {
  const renderer = useMemo(() => new SVG({ padding: 0.5 }), []);
  const failedTiles = useRef(new Set<HTMLImageElement>());
  const [tilesFailed, setTilesFailed] = useState(false);
  const clearTileFailure = ({ tile }: TileEvent) => {
    if (failedTiles.current.delete(tile)) setTilesFailed(failedTiles.current.size > 0);
  };
  return <section className="map-frame" aria-label="Worldwide earthquake map">
    <MapContainer bounds={WORLD_BOUNDS} boundsOptions={{ padding: [12, 12] }} minZoom={0} maxZoom={18}
      worldCopyJump={true} renderer={renderer} className="earthquake-map">
      <MapControls {...(onViewportChange ? { onViewportChange } : {})} />
      <TileLayer url={import.meta.env.VITE_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        eventHandlers={{
          tileerror: ({ tile }) => {
            failedTiles.current.add(tile);
            setTilesFailed(true);
          },
          tileload: clearTileFailure,
          tileunload: clearTileFailure,
          // Leaflet's layer `load` fires even when every tile failed.
        }} />
      {appliedArea && <Rectangle className="applied-area" bounds={[[appliedArea.south, appliedArea.west], [appliedArea.north, appliedArea.east]]} interactive={false}
        pathOptions={{ color: "#264f67", weight: 2, fillOpacity: 0.025 }} />}
      {draftArea && !sameArea(draftArea, appliedArea) && <Rectangle className="pending-area" bounds={[[draftArea.south, draftArea.west], [draftArea.north, draftArea.east]]} interactive={false}
        pathOptions={{ color: "#ac5a29", weight: 2, dashArray: "7 5", fillOpacity: 0.025 }} />}
      {events.map(event => <EarthquakeMarker key={event.id} event={event} selected={event.id === selectedId} onSelect={onSelect} />)}
    </MapContainer>
    {tilesFailed && <div className="tile-warning" role="status">Some map tiles couldn't load. Earthquake data is separate from the basemap.</div>}
    <div className="map-legend" aria-label="Magnitude legend">
      <span className="legend-title">MAGNITUDE</span>
      <span><i className="legend-dot small" /> 1</span>
      <span><i className="legend-dot medium" /> 3</span>
      <span><i className="legend-dot large" /> 5+</span>
      <span><i className="legend-dot unknown" /> Unknown</span>
    </div>
  </section>;
}
