"use client";

import { useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { removeCampaignImage, uploadCampaignImage } from "../../../actions";

const MAX_SIDE = 1800;

/** Downscale to MAX_SIDE and re-encode as JPEG in the browser, so phone photos upload fast and stay under the limit. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

export function ImageSlot({
  campaignId,
  kind,
  title,
  hint,
  current,
  fallback,
  aspect,
}: {
  campaignId: string;
  kind: "background" | "share";
  title: string;
  hint: string;
  current: string | null;
  /** Shown faded when this slot is empty and another image is used instead. */
  fallback?: string | null;
  aspect: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const shown = current ?? fallback ?? null;

  const upload = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("file", await shrink(file));
        const res = await uploadCampaignImage(campaignId, kind, fd);
        if (!res.ok) setError(res.error);
      } catch (e) {
        setError((e as Error).message || "Upload failed.");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  };

  return (
    <div className="flex gap-4">
      <div className="relative w-28 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2" style={{ aspectRatio: aspect }}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className={`h-full w-full object-cover ${current ? "" : "opacity-40"}`} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">None</div>
        )}
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" disabled={pending} onClick={() => input.current?.click()} className="btn btn-sm">
            <ImageUp className="h-3.5 w-3.5" /> {current ? "Replace" : "Upload"}
          </button>
          {current && (
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm(`Remove the ${title.toLowerCase()}?`) && start(() => removeCampaignImage(campaignId, kind))}
              className="btn btn-sm text-bad"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </div>
    </div>
  );
}
