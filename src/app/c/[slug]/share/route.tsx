import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { getCampaignBySlug, scoreCampaign } from "@/lib/score";
import { isAdmin } from "@/lib/admin";
import { manilaToday, num, pesoCompact } from "@/lib/format";
import { publicBaseUrl } from "@/lib/public-url";
import { avatarColors, initials } from "@/components/team-avatar";

export const dynamic = "force-dynamic";

const W = 1080;
const H = 1720;

// Same tokens as the dark leaderboard (globals.css).
const C = {
  bg: "#16181b",
  surface: "#222428",
  surface2: "#2b2e33",
  line: "#34373d",
  text: "#f2f4f6",
  muted: "#8e949c",
  accent: "#5fe3c3",
  gold: "#f4c542",
  badge: "#5b3df5",
};

// Lucide icon shapes used for missions on the page (Flame, Stethoscope, Building, Star), by mission position.
type Node = [string, Record<string, string>];
const ICONS: Node[][] = [
  [["path", { d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" }]],
  [
    ["path", { d: "M11 2v2" }],
    ["path", { d: "M5 2v2" }],
    ["path", { d: "M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" }],
    ["path", { d: "M8 15a6 6 0 0 0 12 0v-3" }],
    ["circle", { cx: "20", cy: "10", r: "2" }],
  ],
  [
    ["path", { d: "M10 12h4" }],
    ["path", { d: "M10 8h4" }],
    ["path", { d: "M14 21v-3a2 2 0 0 0-4 0v3" }],
    ["path", { d: "M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" }],
    ["path", { d: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" }],
  ],
  [
    [
      "path",
      {
        d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
      },
    ],
  ],
];

function Icon({ index, color, size }: { index: number; color: string; size: number }) {
  const nodes = ICONS[Math.max(0, index) % ICONS.length];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {nodes.map(([tag, attrs], i) => (tag === "circle" ? <circle key={i} {...attrs} /> : <path key={i} {...attrs} />))}
    </svg>
  );
}

/** The ribbon medal from components/medal.tsx, drawn for the image renderer. */
function Medal({ size }: { size: number }) {
  return (
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
  );
}

function Avatar({ name, rank, size }: { name: string; rank: number; size: number }) {
  const [bg, fg] = avatarColors(name);
  const b = Math.round(size * 0.42);
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: size,
          backgroundImage: `radial-gradient(circle at 30% 25%, ${fg}, ${bg} 65%)`,
          color: "#fff",
          fontSize: size * 0.34,
          fontWeight: 700,
        }}
      >
        {initials(name)}
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          right: -4,
          bottom: -4,
          width: b,
          height: b,
          borderRadius: b,
          alignItems: "center",
          justifyContent: "center",
          background: C.badge,
          border: `4px solid ${C.surface}`,
          color: "#fff",
          fontSize: b * 0.5,
          fontWeight: 600,
        }}
      >
        {rank}
      </div>
    </div>
  );
}

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" };

// Inter, the leaderboard's font. Google serves TTF to non-browser clients; cached per server process.
let fontCache: Promise<Font[]> | null = null;
function loadFonts(): Promise<Font[]> {
  fontCache ??= (async () => {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800")).text();
    const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?url\((https:[^)]+\.ttf)\)/g)];
    if (!faces.length) throw new Error("no TTF faces in Google Fonts response");
    return Promise.all(
      faces.map(async ([, w, url]) => ({
        name: "Inter",
        data: await (await fetch(url)).arrayBuffer(),
        weight: Number(w) as Font["weight"],
        style: "normal" as const,
      })),
    );
  })().catch((e) => {
    fontCache = null; // retry next time; fall back to the default font now
    console.warn(`[share] font load failed: ${(e as Error).message}`);
    return [];
  });
  return fontCache;
}

/** Shareable PNG mirroring the leaderboard: header, top-3 podium cards, QR code + link. */
export async function GET(_request: Request, { params }: RouteContext<"/c/[slug]/share">) {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign || (campaign.status === "draft" && !(await isAdmin()))) return new Response("Not found", { status: 404 });

  const [{ ruleset, result }, fonts] = await Promise.all([scoreCampaign(campaign), loadFonts()]);
  const top = result.teams.filter((t) => t.total > 0).slice(0, 3);
  // Set PUBLIC_BASE_URL so the QR code works on phones, not just this computer.
  const url = `${await publicBaseUrl()}/c/${slug}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#111318", light: "#ffffff" } });
  const asOf = new Date(`${manilaToday()}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, color: C.text, padding: 64, fontFamily: "Inter" }}>
        {/* Header — like the page title row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>Leaderboard</div>
            <div style={{ display: "flex", fontSize: 28, color: C.muted, marginTop: 6 }}>
              {campaign.name} · Top 3 as of {asOf}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 999, background: "#5fe3c322", color: C.accent, fontSize: 26, fontWeight: 600 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: C.accent }} />
            Live
          </div>
        </div>

        {/* Podium cards — same content and styling as the page */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 44 }}>
          {[0, 1, 2].map((i) => {
            const s = top[i];
            const first = i === 0;
            if (!s) {
              return (
                <div key={i} style={{ display: "flex", height: 250, alignItems: "center", justifyContent: "center", borderRadius: 24, border: `2px dashed ${C.line}`, color: C.muted, fontSize: 30 }}>
                  #{i + 1} is up for grabs
                </div>
              );
            }
            const sub = s.team.mdName ? `${s.team.chcName || "Vacant"} + ${s.team.mdName}` : s.team.chcName || s.team.region || "";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  padding: "30px 40px",
                  borderRadius: 24,
                  background: C.surface,
                  border: first ? `4px solid ${C.gold}cc` : `4px solid ${C.surface}`,
                }}
              >
                {first && (
                  <div style={{ display: "flex", position: "absolute", top: -14, right: 34 }}>
                    <Medal size={84} />
                    <div style={{ display: "flex", position: "absolute", left: 0, top: 58, width: 84, justifyContent: "center", fontSize: 30, fontWeight: 800, color: "#b7871b" }}>1</div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 26, paddingRight: 110 }}>
                  <Avatar name={s.team.name} rank={s.rank} size={first ? 104 : 96} />
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", fontSize: first ? 42 : 38, fontWeight: 600 }}>{s.team.name}</div>
                    <div style={{ display: "flex", fontSize: 26, color: C.muted, marginTop: 4 }}>{sub}</div>
                  </div>
                </div>
                <div style={{ display: "flex", marginTop: 24 }}>
                  {[
                    ["Orders", num(s.orders)],
                    ["Focus sales", pesoCompact(s.focusSales)],
                    ["Points", num(s.total)],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                      <div style={{ display: "flex", fontSize: 20, fontWeight: 500, color: C.muted, letterSpacing: 1.5 }}>{label.toUpperCase()}</div>
                      <div style={{ display: "flex", fontSize: 40, fontWeight: 600, marginTop: 4 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 20 }}>
                  {ruleset.missions.map((m, mi) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 999, background: C.surface2, fontSize: 26, fontWeight: 500 }}>
                      <Icon index={mi} color={m.color} size={26} />
                      {num(s.byMission[m.id] ?? 0)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mission legend so the icon chips read on their own */}
        <div style={{ display: "flex", gap: 30, marginTop: 22, marginBottom: 32, fontSize: 22, color: C.muted }}>
          {ruleset.missions.map((m, mi) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon index={mi} color={m.color} size={22} />
              {m.name}
            </div>
          ))}
        </div>

        {/* QR + link */}
        <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: "auto", padding: 32, borderRadius: 24, background: C.surface }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={230} height={230} style={{ borderRadius: 16 }} alt="" />
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>Scan to see the full ranking</div>
            <div style={{ display: "flex", fontSize: 25, color: C.muted, marginTop: 10 }}>Can&apos;t scan? Open this link:</div>
            <div style={{ display: "flex", fontSize: 29, fontWeight: 600, color: C.accent, marginTop: 6 }}>{url.replace(/^https?:\/\//, "")}</div>
            <div style={{ display: "flex", fontSize: 20, color: C.muted, marginTop: 14 }}>Provisional — subject to management validation</div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${slug}-top3-${manilaToday()}.png"`,
      },
    },
  );
}
