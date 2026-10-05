export const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** ₱88.5K, ₱1.2M */
export const pesoCompact = (n: number) =>
  `₱${new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;

export const num =(n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

export function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function fmtRange(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
  return `${s.toLocaleDateString("en-PH", opts)} – ${e.toLocaleDateString("en-PH", { ...opts, year: "numeric" })}`;
}

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** Days remaining (Asia/Manila calendar), 0 on the last day, negative once over. */
export function daysLeft(end: string) {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(end) - Date.parse(today)) / 86_400_000);
}

/** Today's date (YYYY-MM-DD) on the Asia/Manila calendar. */
export function manilaToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
