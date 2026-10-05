const PALETTE = [
  ["#7c3aed", "#c4b5fd"],
  ["#15803d", "#86efac"],
  ["#b91c1c", "#fca5a5"],
  ["#1d4ed8", "#93c5fd"],
  ["#b45309", "#fcd34d"],
  ["#0e7490", "#67e8f9"],
  ["#be185d", "#f9a8d4"],
  ["#4d7c0f", "#bef264"],
];

function hash(s: string) {
  let h = 7;
  for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** "STC NCL" -> "SN", "BNB E. RODRIGUEZ" -> "BE" */
function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function TeamAvatar({ name, size = 56, rank }: { name: string; size?: number; rank?: number }) {
  const [bg, fg] = PALETTE[hash(name) % PALETTE.length];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-bold"
        // Solid fill + white initials so it reads on both light and dark surfaces.
        style={{
          background: `radial-gradient(circle at 30% 25%, ${fg}, ${bg} 65%)`,
          color: "#fff",
          fontSize: size * 0.34,
          textShadow: "0 1px 2px rgb(0 0 0 / 0.35)",
          boxShadow: `inset 0 0 0 2px ${fg}55`,
        }}
      >
        {initials(name)}
      </span>
      {rank !== undefined && (
        <span
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-[#5b3df5] font-semibold text-white ring-2 ring-surface"
          style={{ width: size * 0.42, height: size * 0.42, fontSize: size * 0.2 }}
        >
          {rank}
        </span>
      )}
    </span>
  );
}
