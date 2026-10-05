/**
 * Doctor names in Zoho are free text, so the same doctor appears as
 * "Dr. Audie V. Cuntapay", "Audie Cuntapay", "Dra. EDESSA REYES CASALLA"…
 * These helpers decide whether two spellings are the same doctor.
 */

const TITLES = /\b(dr|dra|doc|doctora|md|m\.d)\b\.?/g;

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(TITLES, " ")
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function surnameOf(name: string): string | null {
  const t = nameTokens(name);
  return t.length ? t[t.length - 1] : null;
}

/**
 * "same": surname matches and first names agree (equal, or one a prefix of the other: Matt/Matthew, Lyn/Lynn).
 * "possible": surname matches but one side has no first name ("Dr. Osias") — can't confirm either way.
 * null: different doctor.
 */
export function compareDoctors(a: string, b: string): "same" | "possible" | null {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length || ta[ta.length - 1] !== tb[tb.length - 1]) return null;
  const fa = ta.length > 1 ? ta[0] : null;
  const fb = tb.length > 1 ? tb[0] : null;
  if (!fa || !fb) return "possible";
  return fa.startsWith(fb) || fb.startsWith(fa) ? "same" : null;
}

/** Zoho's "contains" search is case-sensitive — the casings worth trying for a surname. */
export function surnameCasings(name: string): string[] {
  const s = surnameOf(name);
  if (!s) return [];
  const typed = name.match(new RegExp(s.replace(/[-]/g, "\\-"), "i"))?.[0] ?? s;
  return [...new Set([typed, s[0].toUpperCase() + s.slice(1), s.toUpperCase(), s])];
}
