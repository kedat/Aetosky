import type { TimePreset } from "@earthquake/shared";
import { displayTimeZone } from "./formatting";
import type { TimeDraft, TimeErrors } from "./timeRange";

interface Props {
  draft: TimeDraft;
  errors: TimeErrors;
  pending: boolean;
  busy: boolean;
  initialLoading: boolean;
  valid: boolean;
  onChange: (draft: TimeDraft) => void;
  onApply: () => void;
}

export function Filters({ draft, errors, pending, busy, initialLoading, valid, onChange, onApply }: Props) {
  return <form className="time-filters" aria-label="Earthquake filters" noValidate onSubmit={event => { event.preventDefault(); if (!busy && valid && pending) onApply(); }}>
    <fieldset disabled={initialLoading}>
      <legend className="visually-hidden">Filter earthquake activity</legend>
      <div className="filter-input period-input"><label htmlFor="time-preset">Time range</label>
        <select id="time-preset" value={draft.preset} onChange={event => onChange({ ...draft, preset: event.target.value as TimePreset })}>
          <option value="past-24-hours">Past 24 hours</option><option value="past-7-days">Past 7 days</option><option value="custom">Custom range</option>
        </select>
      </div>
      {draft.preset === "custom" && <>
        <div className="filter-input time-input"><label htmlFor="time-start">Start date and time</label>
          <input type="datetime-local" id="time-start" step="60" required value={draft.start} aria-invalid={!!errors.start} aria-describedby="time-zone time-start-error"
            onChange={event => onChange({ ...draft, start: event.target.value })} />
          <span id="time-start-error" className="field-error">{errors.start}</span>
        </div>
        <div className="filter-input time-input"><label htmlFor="time-end">End date and time</label>
          <input type="datetime-local" id="time-end" step="60" required value={draft.end} aria-invalid={!!errors.end} aria-describedby="time-zone time-end-error"
            onChange={event => onChange({ ...draft, end: event.target.value })} />
          <span id="time-end-error" className="field-error">{errors.end}</span>
        </div>
      </>}
      <div className="apply-controls"><span className="pending-label" role="status">{pending && !initialLoading ? "Pending changes" : ""}</span>
        <button className="apply-button" type="submit" disabled={busy || !pending || !valid}>Apply filters</button>
      </div>
    </fieldset>
    <p className="filter-help" id="time-zone">Times use {displayTimeZone}. Edit filters, then Apply. Maximum 5,000 events per search.</p>
  </form>;
}
