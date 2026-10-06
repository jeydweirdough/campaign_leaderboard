"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Image as ImageIcon, Loader2, Share2, X } from "lucide-react";

/** Opens a preview of the shareable top-3 PNG with download / share / copy-link actions. */
export function ShareButton({ slug, pageUrl }: { slug: string; pageUrl: string }) {
  const [open, setOpen] = useState(false);
  const [stamp, setStamp] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShareFile, setCanShareFile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const src = `/c/${slug}/share?t=${stamp}`;
  const filename = `${slug}-top3.png`;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const show = () => {
    setStamp(Date.now()); // fresh image every time it's opened
    setLoaded(false);
    setCopied(false);
    try {
      setCanShareFile(!!navigator.canShare?.({ files: [new File([""], filename, { type: "image/png" })] }));
    } catch {
      setCanShareFile(false);
    }
    setOpen(true);
  };

  const share = async () => {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], filename, { type: "image/png" });
    try {
      await navigator.share({ files: [file], title: "Leaderboard top 3", text: `See the full ranking: ${pageUrl}` });
    } catch {
      /* user cancelled */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", pageUrl);
    }
  };

  return (
    <>
      <button
        onClick={show}
        className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-text transition hover:border-accent"
      >
        <ImageIcon className="h-4 w-4 text-accent" />
        <span className="hidden sm:inline">Share top 3</span>
        <span className="sm:hidden">Share</span>
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        className="m-auto max-h-[94vh] w-[min(94vw,440px)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-text backdrop:bg-black/60"
      >
        {open && (
          <div className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Share the top 3</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1 text-muted hover:text-text">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Sized by height so the whole image and the buttons fit on short laptop screens. */}
            <div className="relative mx-auto mt-3 max-w-full overflow-hidden rounded-xl bg-surface-2" style={{ aspectRatio: "1080 / 1720", height: "min(64vh, 560px)" }}>
              {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating image…
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="Top 3 teams with QR code to the leaderboard" onLoad={() => setLoaded(true)} className="h-full w-full object-contain" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a href={src} download={filename} className="btn justify-center">
                <Download className="h-4 w-4" /> Download PNG
              </a>
              {canShareFile ? (
                <button onClick={share} className="btn btn-primary justify-center">
                  <Share2 className="h-4 w-4" /> Share…
                </button>
              ) : (
                <button onClick={copy} className="btn btn-primary justify-center">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Link copied" : "Copy link"}
                </button>
              )}
            </div>
            {canShareFile && (
              <button onClick={copy} className="btn btn-sm mt-2 w-full justify-center">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Link copied" : "Copy link"}
              </button>
            )}
            <p className="mt-3 break-all text-center text-xs text-muted">{pageUrl}</p>
          </div>
        )}
      </dialog>
    </>
  );
}
