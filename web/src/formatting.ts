export const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export const displayTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function formatDate(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : "Not available";
}

export const magnitudeFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
