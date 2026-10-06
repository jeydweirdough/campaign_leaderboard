/**
 * Doctor names in Zoho are free text, so one doctor shows up as "Dr. Audie V. Cuntapay",
 * "Audie Cuntapay", "Roxan A. Perez, M.D.", "Perez, Roxan", "Dr. Osias"…
 * These helpers decide whether two spellings are (probably) the same person, and explain why.
 */

const TITLES = new Set(["dr", "dra", "doc", "doctor", "doctora", "dok", "prof", "mr", "ms", "mrs"]);
const CREDENTIALS = new Set([
  "md", "fpcp", "fpps", "dpps", "dpbo", "fpog", "fpsgs", "fpcs", "fpap", "fpcr", "fpna", "fpnms", "rn", "phd", "mph", "rph", "dmd", "dds", "msc", "mba",
  "jr", "sr", "ii", "iii", "iv",
]);

export type ParsedName = { first: string | null; middles: string[]; last: string | null; tokens: string[] };

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function parseDoctorName(raw: string): ParsedName {
  let s = stripAccents(raw).toLowerCase();
  s = s.replace(/\bm\.?\s?d\.?(?=\s|,|$)/g, " md "); // "M.D." / "M. D." / "MD"
  const words = (part: string) =>
    part
      .replace(/[^a-z\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^-+|-+$/g, ""))
      .filter((w) => w && !TITLES.has(w) && !CREDENTIALS.has(w));

  // "Perez, Roxan A." -> "Roxan A. Perez" (but "Roxan Perez, M.D." keeps its order)
  const parts = s.split(",");
  let tokens: string[];
  if (parts.length > 1 && words(parts[0]).length === 1 && words(parts.slice(1).join(" ")).length > 0) {
    tokens = [...words(parts.slice(1).join(" ")), ...words(parts[0])];
  } else {
    tokens = words(s);
  }
  // "Ma." / "Maria" before another given name is the common Filipino "Maria" prefix, not the first name.
  if (tokens.length > 2 && (tokens[0] === "ma" || tokens[0] === "maria")) tokens = tokens.slice(1);
  // Surname = last token longer than one letter (skips a trailing initial).
  let li = tokens.length - 1;
  while (li >= 0 && tokens[li].length < 2) li--;
  if (li < 0) return { first: null, middles: [], last: null, tokens };
  const last = tokens[li];
  const before = tokens.slice(0, li);
  return { first: before[0] ?? null, middles: before.slice(1), last, tokens };
}

/** Stable key for grouping: credential-, title-, accent- and order-insensitive. */
export function doctorNameKey(raw: string): string {
  const p = parseDoctorName(raw);
  return [p.first, ...p.middles, p.last].filter(Boolean).join(" ");
}

export function surnameOf(name: string): string | null {
  return parseDoctorName(name).last;
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Typo tolerance grows with length: 1 edit for 4+ letters, 2 edits for 6+ (Sheila/Shiela). Only ever yields "possible". */
const closeSpelling = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  const d = levenshtein(a, b);
  return (n >= 4 && d === 1) || (n >= 6 && d === 2);
};

const isInitialOf = (a: string, b: string) => (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
const isPrefix = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));

export type MatchLevel = "same" | "possible";
export type DoctorComparison = { level: MatchLevel; reason: string };

/**
 * same     — very likely the same doctor (applied automatically, admins can overrule)
 * possible — could be the same doctor; needs a human decision
 * null     — different doctors
 */
export function compareDoctors(a: string, b: string): DoctorComparison | null {
  const A = parseDoctorName(a);
  const B = parseDoctorName(b);
  if (!A.last || !B.last) return null;

  if (doctorNameKey(a) === doctorNameKey(b)) return { level: "same", reason: "Same name, different title or formatting" };

  let surnameTypo = false;
  if (A.last !== B.last) {
    if (Math.min(A.last.length, B.last.length) >= 5 && closeSpelling(A.last, B.last)) surnameTypo = true;
    else return null;
  }

  if (!A.first || !B.first) {
    return { level: "possible", reason: `Only the surname "${A.last}" on one invoice` };
  }

  const reasons: string[] = [];
  let level: MatchLevel = "same";
  if (surnameTypo) {
    level = "possible";
    reasons.push(`Surname spelled differently (${A.last} / ${B.last})`);
  }

  if (A.first === B.first) {
    // same first name
  } else if (isInitialOf(A.first, B.first)) {
    level = "possible";
    reasons.push(`First name is only an initial (${A.first} / ${B.first})`);
  } else if (isPrefix(A.first, B.first)) {
    reasons.push(`First name shortened (${A.first} / ${B.first})`);
  } else if (closeSpelling(A.first, B.first)) {
    level = "possible";
    reasons.push(`First name spelled differently (${A.first} / ${B.first})`);
  } else {
    return null;
  }

  // Middle names: a missing middle name or a matching initial is fine; two different full middle names is suspicious.
  const am = A.middles;
  const bm = B.middles;
  if (am.length && bm.length) {
    const compatible = am.some((x) => bm.some((y) => x === y || isInitialOf(x, y) || isPrefix(x, y)));
    const typo = !compatible && am.some((x) => bm.some((y) => closeSpelling(x, y)));
    if (typo) {
      level = "possible";
      reasons.push(`Middle name spelled differently (${am.join(" ")} / ${bm.join(" ")})`);
    } else if (!compatible) {
      level = "possible";
      reasons.push(`Different middle names (${am.join(" ")} / ${bm.join(" ")})`);
    } else if (am.join(" ") !== bm.join(" ")) {
      reasons.push("Middle name written differently");
    }
  } else if (am.length || bm.length) {
    reasons.push("Middle name or initial on one invoice only");
  }

  return { level, reason: reasons.join("; ") || "Same name, different formatting" };
}

/** Zoho's "contains" search is case-sensitive — the casings worth trying for a surname. */
export function surnameCasings(name: string): string[] {
  const s = surnameOf(name);
  if (!s) return [];
  const typed = stripAccents(name).match(new RegExp(s.replace(/[-]/g, "\\-"), "i"))?.[0] ?? s;
  return [...new Set([typed, s[0].toUpperCase() + s.slice(1), s.toUpperCase(), s])];
}

/** Order-independent id for a pair of doctor keys. */
export const pairId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
