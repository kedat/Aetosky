import { useEffect, useLayoutEffect, useRef } from "react";
import type { Earthquake } from "@earthquake/shared";
import { displayTimeZone, formatDate, magnitudeFormat } from "./formatting";

function usgsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "earthquake.usgs.gov" ? url.href : null;
  } catch {
    return null;
  }
}

export function EventDetails({ event, onClose }: { event: Earthquake; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [event.id]);
  useEffect(() => {
    // Mobile details sit below the map. Reveal both on first opening without
    // changing Leaflet's center/zoom or scrolling the page on event switches.
    if (window.matchMedia?.("(max-width: 600px)").matches) {
      panel.current?.parentElement?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, []);
  useEffect(() => {
    const dismiss = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        key.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [onClose]);

  const link = usgsUrl(event.url);
  const depth = event.depthKm === null ? "Not available" : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(event.depthKm)} km`;
  const latitude = `${Math.abs(event.latitude).toFixed(4)}° ${event.latitude < 0 ? "S" : "N"}`;
  const longitude = `${Math.abs(event.longitude).toFixed(4)}° ${event.longitude < 0 ? "W" : "E"}`;

  return <aside ref={panel} id="event-details-panel" className="event-details" aria-labelledby="event-details-heading">
    <div className="details-header">
      <p className="eyebrow">SELECTED EARTHQUAKE</p>
      <button className="details-close" type="button" aria-label="Close earthquake details" onClick={onClose}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
      <h2 id="event-details-heading" ref={heading} tabIndex={-1}>{event.place ?? "Location not available"}</h2>
    </div>
    <div className="details-magnitude">
      <div><span className="detail-label">MAGNITUDE</span><strong>{event.magnitude === null ? "Not available" : `M ${magnitudeFormat.format(event.magnitude)}`}</strong></div>
      <div><span className="detail-label">TYPE</span><span>{event.magnitudeType ?? "Not available"}</span></div>
    </div>
    <dl className="details-fields">
      <div><dt>Occurred <span className="details-timezone">{displayTimeZone}</span></dt><dd>{formatDate(event.occurredAt)}</dd></div>
      <div><dt>Depth</dt><dd>{depth}</dd></div>
      <div><dt>Coordinates <span className="details-timezone">latitude, longitude</span></dt><dd>{latitude}<span className="coordinate-divider"> / </span>{longitude}</dd></div>
      <div><dt>Review status</dt><dd className="review-status">{event.reviewStatus ?? "Not available"}</dd></div>
      <div><dt>Last updated <span className="details-timezone">{displayTimeZone}</span></dt><dd>{formatDate(event.updatedAt)}</dd></div>
    </dl>
    <div className="details-footer">{link
      ? <a href={link} target="_blank" rel="noopener noreferrer">View event on USGS <span aria-hidden="true">↗</span></a>
      : <span>USGS event link: Not available</span>}
    </div>
  </aside>;
}
