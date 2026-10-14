export function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Next monthly anniversary of `startIso` strictly after `now`. Day-of-month
// is clamped to the target month's length (a 31st start renews on the 28th
// or 30th in shorter months) rather than rolling into the following month.
export function nextMonthlyRenewal(startIso: string, now: Date = new Date()): Date {
  const start = new Date(startIso);
  const day = start.getDate();
  for (let i = 1; ; i++) {
    const year = start.getFullYear() + Math.floor((start.getMonth() + i) / 12);
    const month = (start.getMonth() + i) % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const candidate = new Date(year, month, Math.min(day, lastDay), start.getHours(), start.getMinutes());
    if (candidate > now) return candidate;
  }
}
