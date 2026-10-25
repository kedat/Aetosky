import { useCallback, useEffect, useRef, useState } from "react";
import { EarthquakeMap } from "./EarthquakeMap";
import { EventDetails } from "./EventDetails";
import { dateFormat, displayTimeZone } from "./formatting";
import { Filters } from "./Filters";
import { initialTimeDraft, periodLabel, validateTimeDraft, sameTimeRequest } from "./timeRange";
import { useEarthquakes } from "./useEarthquakes";

export function App() {
  const { state, request } = useEarthquakes();
  const [draft, setDraft] = useState(initialTimeDraft);
  const validation = validateTimeDraft(draft);
  const requested = validation.request;
  const pending = !sameTimeRequest(requested, state.applied);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectionTrigger = useRef<HTMLElement | SVGElement | null>(null);
  const selectEvent = useCallback((id: string) => {
    const trigger = document.activeElement;
    selectionTrigger.current = trigger instanceof HTMLElement || trigger instanceof SVGElement ? trigger : null;
    setSelectedId(id);
  }, []);
  const closeDetails = useCallback(() => {
    setSelectedId(null);
    selectionTrigger.current?.focus({ preventScroll: true });
  }, []);
  const snapshot = state.snapshot;
  useEffect(() => {
    if (snapshot && selectedId && !snapshot.events.some(event => event.id === selectedId)) setSelectedId(null);
  }, [snapshot, selectedId]);
  const selectedEvent = snapshot?.events.find(event => event.id === selectedId) ?? null;
  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Earthquake Explorer home">
        <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" /><circle cx="16" cy="16" r="7" /><circle cx="16" cy="16" r="2" /></svg>
        <span>Earthquake<span className="brand-light"> Explorer</span></span>
      </a>
      <div className="header-actions">
        <a className="source-link" href="https://earthquake.usgs.gov/" target="_blank" rel="noreferrer">Data by USGS <span aria-hidden="true">↗</span></a></div>
    </header>

    <main>
      <div className="overview-heading">
        <div><p className="eyebrow">GLOBAL OVERVIEW</p><h1>Explore earthquake activity.</h1>
          <p className="intro">Explore where earthquakes have been recorded around the world.</p></div>
        <div className="period-badge"><span className="clock-icon" aria-hidden="true">◷</span> {periodLabel(snapshot?.scope.time.preset ?? "past-24-hours")}</div>
      </div>

      <div className="filter-panel">
      <Filters draft={draft} errors={validation.errors}
        pending={pending} busy={state.status === "loading"} initialLoading={!snapshot && state.status === "loading"}
        valid={!!requested} onChange={setDraft}
        onApply={() => {
          if (requested) {
            void request(requested);
          }
        }} />
      </div>

      {snapshot && state.status === "loading" && <div className="request-banner" role="status"><span className="spinner" aria-hidden="true" />{state.intent === "reset" ? "Returning to overview." : `Updating to ${periodLabel(state.requested.preset)} · worldwide.`} Previous results and scope remain displayed.</div>}
      {snapshot && state.status === "error" && <div className="request-banner request-error" role="alert"><span>{state.error} Previous results and scope remain displayed.</span><button onClick={() => void request(state.requested, state.intent)}>Retry</button></div>}

      <section className="scope-panel" aria-label="Displayed data scope">
        <div className="scope-cell"><span className="scope-label">AREA</span><strong>Worldwide</strong>
</div>
        <div className="scope-cell time-cell"><span className="scope-label">TIME WINDOW <span className="timezone">{displayTimeZone}</span></span>
          {snapshot ? <div className="time-range"><time dateTime={snapshot.scope.time.start}>{dateFormat.format(new Date(snapshot.scope.time.start))}</time><span aria-hidden="true">→</span><time dateTime={snapshot.scope.time.end}>{dateFormat.format(new Date(snapshot.scope.time.end))}</time></div>
            : <span className="scope-placeholder">{state.status === "loading" ? "Loading exact time window…" : "Time window unavailable"}</span>}
        </div>
        <div className="scope-cell"><span className="scope-label">MAGNITUDE</span><strong>All reported magnitudes</strong></div>
        <div className="scope-cell count-cell"><span className="scope-label">EARTHQUAKES</span><strong>{snapshot ? snapshot.count.toLocaleString() : "—"}</strong></div>
      </section>

      <div className="map-section" aria-busy={state.status === "loading"}>
        <EarthquakeMap events={snapshot?.events ?? []} selectedId={selectedEvent?.id ?? null} onSelect={selectEvent} />
        {selectedEvent && <EventDetails event={selectedEvent} onClose={closeDetails} />}
        {!snapshot && state.status === "loading" && <div className="map-notice" role="status"><span className="spinner" aria-hidden="true" /><strong>Loading earthquake activity…</strong><span>Getting earthquake data from USGS.</span></div>}
        {!snapshot && state.status === "error" && <div className="map-notice" role="alert"><span className="notice-icon" aria-hidden="true">!</span><strong>Earthquake data couldn't load.</strong><span>{state.error}</span><button onClick={() => void request(state.requested, state.intent)}>Retry</button></div>}
        {snapshot?.count === 0 && <div className="map-notice" role="status"><strong>No earthquakes match the displayed filters.</strong><span>{state.status === "ready" ? "Adjust the filters and Apply to explore more activity." : "These are the previous successful results."}</span></div>}
      </div>

      <footer className="data-footer">
        <p>USGS-recorded earthquakes <span aria-hidden="true">·</span> Select a marker for details</p>
        <div aria-live="polite">{snapshot ? <>
          <span>Data generated: {snapshot.source.generatedAt ? <time dateTime={snapshot.source.generatedAt}>{dateFormat.format(new Date(snapshot.source.generatedAt))}</time> : "Not provided"}</span>
          <span>Retrieved: <time dateTime={snapshot.source.retrievedAt}>{dateFormat.format(new Date(snapshot.source.retrievedAt))}</time></span>
        </> : <span>{state.status === "loading" ? "Waiting for USGS data" : "No successful retrieval"}</span>}</div>
      </footer>
    </main>
  </div>;
}
