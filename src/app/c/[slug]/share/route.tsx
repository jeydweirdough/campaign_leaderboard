import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCampaignBySlug, previousRanks, scoreCampaign } from "@/lib/score";
import { isAdmin } from "@/lib/admin";
import { manilaToday, num } from "@/lib/format";
import { publicBaseUrl } from "@/lib/public-url";
import { avatarColors, initials } from "@/components/team-avatar";
import type { TeamScore } from "@/lib/rules/engine";

export const dynamic = "force-dynamic";

/** Daily "Top 6 flash" image: wordmark, podium for 1–3, rows for 4–6, QR + link — with a basketball-court backdrop. */

const W = 1080;
const H = 1580;

// Leaderboard tokens (globals.css) + medal colours.
const C = {
  bg: "#16181b",
  bgDeep: "#0f1114",
  surface: "#222428",
  surface2: "#2b2e33",
  line: "#34373d",
  text: "#f2f4f6",
  muted: "#8e949c",
  accent: "#5fe3c3",
  good: "#22c55e",
  bad: "#ef4444",
};
const PLACES = [
  { ring: "#f4c542", step: 150, avatar: 150 }, // 1st
  { ring: "#c9d1db", step: 105, avatar: 118 }, // 2nd
  { ring: "#d9905a", step: 75, avatar: 118 }, // 3rd
];

// ---------- assets ----------

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" };
let fontCache: Promise<Font[]> | null = null;
/** Inter (the site font). Google serves TTF to non-browser clients; cached per server process. */
function loadFonts(): Promise<Font[]> {
  fontCache ??= (async () => {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800")).text();
    const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?url\((https:[^)]+\.ttf)\)/g)];
    if (!faces.length) throw new Error("no TTF faces in Google Fonts response");
    return Promise.all(
      faces.map(async ([, w, url]) => ({ name: "Inter", data: await (await fetch(url)).arrayBuffer(), weight: Number(w) as Font["weight"], style: "normal" as const })),
    );
  })().catch((e) => {
    fontCache = null;
    console.warn(`[share] font load failed: ${(e as Error).message}`);
    return [];
  });
  return fontCache;
}

/** Campaign artwork as something the renderer can draw: a data URI for /public files, else the URL. */
async function loadArtwork(src: string | null): Promise<string | null> {
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  try {
    const file = path.join(process.cwd(), "public", src.replace(/^\/+/, ""));
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
  } catch (e) {
    console.warn(`[share] background not found: ${src} (${(e as Error).message})`);
    return null;
  }
}

// ---------- helpers ----------

/** "RISE" + "Reignite · Inspire · Succeed · Excel — The Rx Impact League" → acronym parts. */
function brand(name: string, tagline: string) {
  const [word, ...rest] = name.split(/\s+/);
  const [acronymPart, ...after] = tagline.split(/\s+—\s+/);
  const expansion = acronymPart.split(/\s*·\s*/).filter(Boolean);
  const isAcronym = expansion.length === word.length && expansion.every((w, i) => w[0]?.toLowerCase() === word[i]?.toLowerCase());
  return isAcronym
    ? { word, expansion, rest: rest.join(" "), subtitle: after.join(" — ") }
    : { word: name, expansion: [] as string[], rest: "", subtitle: tagline };
}

const subtitleOf = (t: TeamScore) => (t.team.mdName ? `${t.team.chcName || "Vacant"} + ${t.team.mdName}` : t.team.chcName || t.team.region || "");

// ---------- pieces ----------

function Movement({ prev, now, size = 22 }: { prev: number | undefined; now: number; size?: number }) {
  if (prev === undefined) return null;
  const d = prev - now;
  const [label, color, bg] = d > 0 ? [`▲ ${d}`, C.good, "#22c55e22"] : d < 0 ? [`▼ ${-d}`, C.bad, "#ef444422"] : ["—", C.muted, C.surface2];
  return <div style={{ display: "flex", padding: "4px 14px", borderRadius: 999, background: bg, color, fontSize: size, fontWeight: 700 }}>{label}</div>;
}

function Avatar({ name, size, ring }: { name: string; size: number; ring?: string }) {
  const [bg, fg] = avatarColors(name);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        backgroundImage: `radial-gradient(circle at 30% 25%, ${fg}, ${bg} 65%)`,
        border: ring ? `6px solid ${ring}` : "none",
        color: "#fff",
        fontSize: size * 0.32,
        fontWeight: 800,
      }}
    >
      {initials(name)}
    </div>
  );
}

function Medal({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size * 1.35 }}>
      <svg width={size} height={size * 1.35} viewBox="0 0 72 98">
        <defs>
          <radialGradient id="m" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="55%" stopColor="#f4c542" />
            <stop offset="100%" stopColor="#b7871b" />
          </radialGradient>
        </defs>
        <path d="M14 0h14l14 40H28z" fill="#1d4ed8" />
        <path d="M44 0h14L44 40H30z" fill="#dc2626" />
        <path d="M22 0h6l14 40h-6z" fill="#f8fafc" opacity="0.9" />
        <path d="M44 0h6L36 40h-6z" fill="#f8fafc" opacity="0.9" />
        <circle cx="36" cy="64" r="30" fill="url(#m)" stroke="#b7871b" strokeWidth="2" />
        <circle cx="36" cy="64" r="22" fill="none" stroke="#b7871b" strokeOpacity="0.45" strokeWidth="2" />
      </svg>
      <div style={{ display: "flex", position: "absolute", left: 0, top: size * 0.68, width: size, justifyContent: "center", fontSize: size * 0.36, fontWeight: 800, color: "#8a6410" }}>
        1
      </div>
    </div>
  );
}

/** Decorative basketball for the backdrop. */
function Ball({ size, x, y, opacity, rotate = 0 }: { size: number; x: number; y: number; opacity: number; rotate?: number }) {
  return (
    <div style={{ display: "flex", position: "absolute", left: x, top: y, width: size, height: size, opacity, transform: `rotate(${rotate}deg)` }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <defs>
          <radialGradient id="ball" cx="34%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#ffb867" />
            <stop offset="50%" stopColor="#e8761c" />
            <stop offset="100%" stopColor="#8a3509" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#ball)" />
        <path d="M50 2 V98" stroke="#2a1205" strokeWidth="2.4" fill="none" />
        <path d="M2 50 H98" stroke="#2a1205" strokeWidth="2.4" fill="none" />
        <path d="M17 11 Q44 50 17 89" stroke="#2a1205" strokeWidth="2.4" fill="none" />
        <path d="M83 11 Q56 50 83 89" stroke="#2a1205" strokeWidth="2.4" fill="none" />
      </svg>
    </div>
  );
}

/** Faint court markings: half-court line, centre circle behind the podium, three-point arc at the bottom. */
function CourtLines() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", top: 0, left: 0 }}>
      <g fill="none" stroke="#ffffff" strokeOpacity="0.09" strokeWidth="4">
        <line x1="0" y1="760" x2={W} y2="760" />
        <circle cx={W / 2} cy="760" r="210" />
        <circle cx={W / 2} cy="760" r="70" />
        <path d={`M 90 ${H} L 90 1300 A 450 450 0 0 1 ${W - 90} 1300 L ${W - 90} ${H}`} />
        <rect x={W / 2 - 160} y="1340" width="320" height="260" />
      </g>
    </svg>
  );
}

// ---------- route ----------

export async function GET(_request: Request, { params }: RouteContext<"/c/[slug]/share">) {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign || (campaign.status === "draft" && !(await isAdmin()))) return new Response("Not found", { status: 404 });

  const [{ result }, prev, fonts, art] = await Promise.all([scoreCampaign(campaign), previousRanks(campaign), loadFonts(), loadArtwork(campaign.backgroundImage)]);
  const top = result.teams.filter((t) => t.total > 0).slice(0, 6);
  // Set PUBLIC_BASE_URL so the QR code works on phones, not just this computer.
  const url = `${await publicBaseUrl()}/c/${slug}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 300, color: { dark: "#111318", light: "#ffffff" } });

  const today = manilaToday();
  const dateLabel = new Date(`${today}T00:00:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const totalDays = Math.round((Date.parse(campaign.endDate) - Date.parse(campaign.startDate)) / 86_400_000) + 1;
  const dayNo = Math.min(totalDays, Math.max(1, Math.round((Date.parse(today) - Date.parse(campaign.startDate)) / 86_400_000) + 1));
  const b = brand(campaign.name, campaign.tagline);

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", backgroundImage: `linear-gradient(180deg, ${C.bgDeep}, ${C.bg} 45%, ${C.bgDeep})`, color: C.text, fontFamily: "Inter" }}>
        {/* ---- backdrop: campaign artwork, court lines, basketballs ---- */}
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover", objectPosition: "center top" }} />
        )}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: W,
            height: H,
            backgroundImage: art
              ? "linear-gradient(180deg, rgba(15,17,20,0.97) 0%, rgba(15,17,20,0.93) 27%, rgba(15,17,20,0.62) 42%, rgba(15,17,20,0.6) 58%, rgba(15,17,20,0.82) 70%, rgba(15,17,20,0.96) 100%)"
              : "radial-gradient(circle at 50% 0%, rgba(95,227,195,0.18), transparent 55%)",
          }}
        />
        <CourtLines />
        <Ball size={300} x={W - 190} y={-90} opacity={0.22} rotate={18} />
        <Ball size={180} x={-70} y={440} opacity={0.16} rotate={-25} />
        <Ball size={140} x={W - 110} y={620} opacity={0.14} rotate={40} />
        <Ball size={240} x={-100} y={H - 300} opacity={0.12} rotate={10} />

        {/* ---- content ---- */}
        <div style={{ display: "flex", flexDirection: "column", position: "relative", width: W, height: H, padding: "52px 60px" }}>
          {/* Top row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px", borderRadius: 999, background: "#5fe3c322", color: C.accent, fontSize: 24, fontWeight: 700, letterSpacing: 3 }}>
              <div style={{ width: 12, height: 12, borderRadius: 6, background: C.accent }} />
              DAILY TOP 6
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 24, fontWeight: 600 }}>{dateLabel}</div>
              <div style={{ display: "flex", fontSize: 20, color: C.muted, marginTop: 2 }}>
                Game day {dayNo} of {totalDays}
              </div>
            </div>
          </div>

          {/* Wordmark + full form */}
          <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 30 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: b.expansion.length ? 170 : 72, fontWeight: 800, letterSpacing: b.expansion.length ? -6 : -2, lineHeight: 1 }}>{b.word}</div>
              {b.rest && <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: C.muted, marginTop: 6 }}>{b.rest}</div>}
            </div>
            {b.expansion.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 36, borderLeft: `3px solid ${C.line}` }}>
                {b.expansion.map((w) => (
                  <div key={w} style={{ display: "flex", fontSize: 38, fontWeight: 500, color: C.muted, lineHeight: 1.18 }}>
                    <span style={{ color: PLACES[0].ring, fontWeight: 800 }}>{w[0]}</span>
                    {w.slice(1)}
                  </div>
                ))}
              </div>
            )}
          </div>
          {b.subtitle && <div style={{ display: "flex", fontSize: 26, fontWeight: 600, color: C.accent, marginTop: 18 }}>{b.subtitle}</div>}

          {/* Podium: 2 · 1 · 3 */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginTop: 34 }}>
            {[1, 0, 2].map((i) => {
              const t = top[i];
              const p = PLACES[i];
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, textShadow: "0 2px 10px rgba(0,0,0,0.85)" }}>
                  {i === 0 && (
                    <div style={{ display: "flex", marginBottom: 4 }}>
                      <Medal size={64} />
                    </div>
                  )}
                  {t ? <Avatar name={t.team.name} size={p.avatar} ring={p.ring} /> : <div style={{ display: "flex", width: p.avatar, height: p.avatar, borderRadius: p.avatar, border: `4px dashed ${C.line}` }} />}
                  <div style={{ display: "flex", fontSize: i === 0 ? 32 : 27, fontWeight: 700, marginTop: 14, textAlign: "center", justifyContent: "center", width: "100%" }}>
                    {t ? t.team.name : "Up for grabs"}
                  </div>
                  {t && (
                    <div style={{ display: "flex", fontSize: 19, color: "#b5bac2", marginTop: 4, textAlign: "center", justifyContent: "center", width: "100%", lineHeight: 1.3 }}>
                      {subtitleOf(t)}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
                    <div style={{ display: "flex", fontSize: i === 0 ? 64 : 50, fontWeight: 800, letterSpacing: -1 }}>{t ? num(t.total) : "—"}</div>
                    <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: C.muted }}>PTS</div>
                  </div>
                  {t && (
                    <div style={{ display: "flex", marginTop: 6 }}>
                      <Movement prev={prev.get(t.team.id)} now={t.rank} size={20} />
                    </div>
                  )}
                  {/* hardwood podium step */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "center",
                      width: "100%",
                      height: p.step,
                      marginTop: 16,
                      borderRadius: "14px 14px 4px 4px",
                      borderTop: `8px solid ${p.ring}`,
                      backgroundImage:
                        "linear-gradient(90deg, #8a5426 0%, #a8693a 9%, #94592b 18%, #b07343 30%, #8f5528 42%, #a66737 55%, #92592a 68%, #ad7040 82%, #8a5426 100%)",
                      color: "#fff7e8",
                      fontSize: i === 0 ? 72 : 56,
                      fontWeight: 800,
                      paddingTop: 6,
                      textShadow: "0 3px 8px rgba(40,18,4,0.8)",
                    }}
                  >
                    {i + 1}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 4 – 6 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 22 }}>
            {[3, 4, 5].map((i) => {
              const t = top[i];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, padding: "16px 26px", borderRadius: 20, background: art ? "rgba(34,36,40,0.88)" : C.surface }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 54, background: C.surface2, fontSize: 26, fontWeight: 800 }}>{i + 1}</div>
                  {t ? <Avatar name={t.team.name} size={60} /> : <div style={{ display: "flex", width: 60, height: 60, borderRadius: 60, border: `3px dashed ${C.line}` }} />}
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: t ? C.text : C.muted }}>{t ? t.team.name : "Up for grabs"}</div>
                    {t && <div style={{ display: "flex", fontSize: 19, color: C.muted, marginTop: 2 }}>{subtitleOf(t)}</div>}
                  </div>
                  {t && <Movement prev={prev.get(t.team.id)} now={t.rank} size={20} />}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 140, justifyContent: "flex-end" }}>
                    <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>{t ? num(t.total) : "—"}</div>
                    <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: C.muted }}>PTS</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* QR + link */}
          <div style={{ display: "flex", alignItems: "center", gap: 32, marginTop: "auto", padding: 26, borderRadius: 24, background: art ? "rgba(34,36,40,0.92)" : C.surface }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} width={170} height={170} style={{ borderRadius: 14 }} alt="" />
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>See the full ranking</div>
              <div style={{ display: "flex", fontSize: 22, color: C.muted, marginTop: 8 }}>Scan the code, or open:</div>
              <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: C.accent, marginTop: 4 }}>{url.replace(/^https?:\/\//, "")}</div>
              <div style={{ display: "flex", fontSize: 18, color: C.muted, marginTop: 10 }}>Provisional — subject to management validation · ▲▼ vs yesterday</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts,
      headers: { "Cache-Control": "no-store", "Content-Disposition": `inline; filename="${slug}-top6-${today}.png"` },
    },
  );
}
