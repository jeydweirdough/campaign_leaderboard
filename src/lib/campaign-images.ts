import "server-only";
import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, schema } from "@/lib/db";

export type ImageKind = "background" | "share";
export const IMAGE_KINDS: readonly ImageKind[] = ["background", "share"];
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Public URL of an uploaded image; `v` busts browser caches after a replace. */
export const uploadedImageUrl = (campaignId: string, kind: ImageKind, v: number | string) => `/api/campaign-image/${campaignId}/${kind}?v=${v}`;

const UPLOADED = /^\/api\/campaign-image\/([^/]+)\/(background|share)(?:\?|$)/;

export async function getUploadedImage(campaignId: string, kind: ImageKind) {
  return db.query.campaignImages.findFirst({
    where: and(eq(schema.campaignImages.campaignId, campaignId), eq(schema.campaignImages.kind, kind)),
  });
}

/**
 * Artwork as something the OG renderer can draw: uploaded images and /public files become
 * data URIs (the renderer can't fetch relative URLs), full URLs pass through.
 */
export async function loadImageForRender(src: string | null): Promise<string | null> {
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  try {
    const m = src.match(UPLOADED);
    if (m) {
      const img = await getUploadedImage(m[1], m[2] as ImageKind);
      return img ? `data:${img.mime};base64,${img.data}` : null;
    }
    const file = path.join(process.cwd(), "public", src.replace(/^\/+/, "").split("?")[0]);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
  } catch (e) {
    console.warn(`[image] not found: ${src} (${(e as Error).message})`);
    return null;
  }
}
