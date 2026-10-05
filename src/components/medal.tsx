/** Ribbon medal, drawn inline so it scales crisply. */
export function Medal({ place = 1, size = 72 }: { place?: 1 | 2 | 3; size?: number }) {
  const [light, mid, dark] =
    place === 1 ? ["#fde68a", "#f4c542", "#b7871b"] : place === 2 ? ["#f1f5f9", "#c9d1db", "#8a94a3"] : ["#f6c39b", "#d9905a", "#9a5a2c"];
  const id = `medal-${place}`;
  return (
    <svg width={size} height={size * 1.35} viewBox="0 0 72 98" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={light} />
          <stop offset="55%" stopColor={mid} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      </defs>
      {/* ribbon */}
      <path d="M14 0h14l14 40H28z" fill="#1d4ed8" />
      <path d="M44 0h14L44 40H30z" fill="#dc2626" />
      <path d="M22 0h6l14 40h-6z" fill="#f8fafc" opacity="0.9" />
      <path d="M44 0h6L36 40h-6z" fill="#f8fafc" opacity="0.9" />
      {/* coin */}
      <circle cx="36" cy="64" r="30" fill={`url(#${id})`} stroke={dark} strokeWidth="2" />
      <circle cx="36" cy="64" r="22" fill="none" stroke={dark} strokeOpacity="0.45" strokeWidth="2" />
      <text x="36" y="73" textAnchor="middle" fontSize="26" fontWeight="800" fill={dark} fontFamily="Inter, sans-serif">
        {place}
      </text>
    </svg>
  );
}
