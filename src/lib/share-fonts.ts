import "server-only";

export type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" };

export const DEFAULT_FONT = "Inter";
/** Suggestions for the admin picker; any Google Fonts family name works. */
export const SUGGESTED_FONTS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "Oswald",
  "Bebas Neue",
  "Anton",
  "Archivo Black",
  "Barlow Condensed",
  "Teko",
  "Russo One",
  "Bungee",
  "Rubik",
  "Roboto",
  "Lato",
  "Nunito",
  "Playfair Display",
];

const WEIGHTS = [400, 500, 600, 700, 800] as const;
const cache = new Map<string, Promise<Font[]>>();

/**
 * TTF faces of a Google Fonts family (Google serves TTF to non-browser clients), cached per server process.
 * Each weight is requested on its own because Google rejects the whole request if one weight doesn't exist
 * (e.g. Bebas Neue only has 400); the renderer picks the nearest weight that loaded.
 */
export function loadGoogleFont(family: string): Promise<Font[]> {
  const key = family.trim();
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const faces = await Promise.all(
        WEIGHTS.map(async (weight): Promise<Font | null> => {
          const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(key)}:wght@${weight}`);
          if (!res.ok) return null;
          const url = (await res.text()).match(/url\((https:[^)]+\.ttf)\)/)?.[1];
          if (!url) return null;
          return { name: key, data: await (await fetch(url)).arrayBuffer(), weight, style: "normal" };
        }),
      );
      const found = faces.filter((f): f is Font => f !== null);
      if (!found.length) throw new Error(`"${key}" is not a Google Fonts family`);
      return found;
    })().catch((e) => {
      cache.delete(key);
      console.warn(`[fonts] ${(e as Error).message}`);
      return [];
    });
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Fonts for the share image. Returns the family names to put in `fontFamily`; a family that fails to load
 * falls back to Inter so the image still renders.
 */
export async function loadShareFonts(display: string | null, body: string | null) {
  const want = [...new Set([DEFAULT_FONT, display || DEFAULT_FONT, body || DEFAULT_FONT])];
  const loaded = await Promise.all(want.map(loadGoogleFont));
  const ok = new Set(want.filter((_, i) => loaded[i].length));
  const pick = (f: string | null) => (f && ok.has(f) ? f : DEFAULT_FONT);
  return { fonts: loaded.flat(), display: pick(display), body: pick(body) };
}
