import { useEffect, useMemo, useRef, useState } from "react";
import { SVG } from "leaflet";
import type { CircleMarker as LeafletCircleMarker, TileEvent } from "leaflet";
import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";
import type { Earthquake } from "@earthquake/shared";
import { magnitudeFormat } from "./formatting";
const WORLD_BOUNDS: [[number, number], [number, number]] = [[-60, -180], [75, 180]];

export interface EarthquakeMapProps {
  events: Earthquake[];
}

export function EarthquakeMap({ events }: EarthquakeMapProps) {
  const renderer = useMemo(() => new SVG({ padding: 0.5 }), []);
  const failedTiles = useRef(new Set<HTMLImageElement>());
  const [tilesFailed, setTilesFailed] = useState(false);
  const clearTileFailure = ({ tile }: TileEvent) => {
    if (failedTiles.current.delete(tile)) setTilesFailed(failedTiles.current.size > 0);
  };
  return <section className="map-frame" aria-label="Worldwide earthquake map">
    <MapContainer bounds={WORLD_BOUNDS} boundsOptions={{ padding: [12, 12] }} minZoom={0} maxZoom={18}
      worldCopyJump={true} renderer={renderer} className="earthquake-map">
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
      {events.map(event => <CircleMarker key={event.id} center={[event.latitude, event.longitude]} radius={event.magnitude === null ? 4 : Math.max(3, 3 + Math.max(0, event.magnitude) * 1.6)} pathOptions={{ color: "#c24c24", fillColor: "#ef7846", fillOpacity: 0.65, weight: 1.2 }} />)}
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
