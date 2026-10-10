"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { saveShareFonts } from "../../../actions";

/** Loads a Google Fonts family into this page so the sample can show it. */
function FontLink({ family }: { family: string }) {
  if (!family.trim()) return null;
  return <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim())}:wght@400;700;800&display=swap`} />;
}

function Field({ label, hint, value, onChange, sample }: { label: string; hint: string; value: string; onChange: (v: string) => void; sample: React.ReactNode }) {
  const family = value.trim() || "Inter";
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" list="share-font-list" placeholder="Inter" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="mt-1 block text-xs text-muted">{hint}</span>
      <div className="mt-2 truncate rounded-lg border border-line bg-surface-2 px-3 py-2" style={{ fontFamily: `"${family}", Inter, sans-serif` }}>
        {sample}
      </div>
    </label>
  );
}

export function FontPicker({
  campaignId,
  slug,
  display: initialDisplay,
  body: initialBody,
  suggestions,
}: {
  campaignId: string;
  slug: string;
  display: string | null;
  body: string | null;
  suggestions: string[];
}) {
  const [display, setDisplay] = useState(initialDisplay ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = display !== (initialDisplay ?? "") || body !== (initialBody ?? "");

  const save = () =>
    start(async () => {
      setStatus(null);
      const res = await saveShareFonts(campaignId, display, body);
      setStatus(res.ok ? { ok: true, text: "Saved. The next share image uses these fonts." } : { ok: false, text: res.error });
    });

  return (
    <div className="space-y-4">
      <FontLink family={display} />
      <FontLink family={body} />
      <datalist id="share-font-list">
        {suggestions.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Headline font"
          hint="Big title, team names, points and ranks."
          value={display}
          onChange={setDisplay}
          sample={<span className="text-2xl font-extrabold">RISE · BNB NCL 233</span>}
        />
        <Field
          label="Text font"
          hint="Date, names under teams, labels and the QR box."
          value={body}
          onChange={setBody}
          sample={<span className="text-sm">Vacant + Khalygen Boayes · Scan the code</span>}
        />
      </div>
      <p className="text-xs text-muted">Pick from the list or type any family name from fonts.google.com. Leave blank for Inter.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending || !dirty} className="btn btn-primary btn-sm">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save fonts
        </button>
        <a href={`/c/${slug}/share`} target="_blank" rel="noreferrer" className="btn btn-sm">
          <ExternalLink className="h-3.5 w-3.5" /> Preview share image
        </a>
        {status && <span className={`text-xs ${status.ok ? "text-good" : "text-bad"}`}>{status.text}</span>}
      </div>
    </div>
  );
}
