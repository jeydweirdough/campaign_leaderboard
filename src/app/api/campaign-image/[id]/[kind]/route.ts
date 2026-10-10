import { getUploadedImage, IMAGE_KINDS, type ImageKind } from "@/lib/campaign-images";

/** Serves campaign artwork uploaded from the admin. URLs carry ?v=<upload time>, so they can be cached hard. */
export async function GET(_request: Request, { params }: RouteContext<"/api/campaign-image/[id]/[kind]">) {
  const { id, kind } = await params;
  if (!IMAGE_KINDS.includes(kind as ImageKind)) return new Response("Not found", { status: 404 });
  const img = await getUploadedImage(id, kind as ImageKind);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.data, "base64"), {
    headers: { "content-type": img.mime, "cache-control": "public, max-age=31536000, immutable" },
  });
}
