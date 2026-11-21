"use client";

import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/client-api";
import { WEEKDAYS, hhmmToMinutes, minutesToHHMM } from "@/lib/format";
import type { ApiBusiness, Window } from "../types";
import { useLoad } from "../use-load";
import { Alert, Spinner, btnPrimary, btnSecondary, cardCls, inputCls } from "../ui";

// inputCls sets w-full; swap it rather than appending w-32 (Tailwind would let w-full win).
const timeCls = inputCls.replace("w-full", "w-32");

type Draft = Record<number, { start: string; end: string }[]>;

function toDraft(windows: Window[]): Draft {
  const d: Draft = {};
  for (const { n } of WEEKDAYS) d[n] = [];
  for (const w of windows) d[w.weekday]!.push({ start: minutesToHHMM(w.startMin), end: minutesToHHMM(w.endMin) });
  return d;
}

function toWindows(draft: Draft): Window[] {
  const out: Window[] = [];
  for (const { n } of WEEKDAYS) {
    for (const w of draft[n] ?? []) {
      const startMin = hhmmToMinutes(w.start);
      // A closing time of 00:00 means "midnight at the end of the day".
      const endMin = hhmmToMinutes(w.end) || 1440;
      out.push({ weekday: n, startMin, endMin });
    }
  }
  return out;
}

export default function AvailabilityEditor() {
  const { data, error, loading } = useLoad<{ windows: Window[] }>("/api/availability");
  const biz = useLoad<{ business: ApiBusiness }>("/api/business");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setDraft(toDraft(data.windows));
  }, [data]);

  function change(fn: (d: Draft) => Draft) {
    setDraft((d) => (d ? fn(d) : d));
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api("/api/availability", { method: "PUT", body: { windows: toWindows(draft) } });
      setSaved(true);
    } catch (e) {
      setSaveError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Opening hours</h1>
        <p className="mt-1 text-sm text-stone-600">
          Hours follow your shop&apos;s clock{biz.data ? ` (${biz.data.business.timezone.replace(/_/g, " ")})` : ""}, including daylight-saving changes. Add two windows for a lunch break.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && !draft && <Spinner />}

      {draft && (
        <>
          <ul className={`${cardCls} divide-y divide-stone-100`}>
            {WEEKDAYS.map(({ n, label }) => {
              const rows = draft[n] ?? [];
              return (
                <li key={n} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-4">
                  <div className="flex w-36 items-center gap-3 pt-2">
                    <input
                      id={`open-${n}`}
                      type="checkbox"
                      className="h-4 w-4 accent-teal-700"
                      checked={rows.length > 0}
                      onChange={(e) =>
                        change((d) => ({ ...d, [n]: e.target.checked ? [{ start: "09:00", end: "17:00" }] : [] }))
                      }
                    />
                    <label htmlFor={`open-${n}`} className="text-sm font-medium">
                      {label}
                    </label>
                  </div>

                  <div className="flex-1 space-y-2">
                    {rows.length === 0 && <p className="pt-2 text-sm text-stone-500">Closed</p>}
                    {rows.map((w, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <input
                          aria-label={`${label} opens`}
                          type="time"
                          step={300}
                          className={timeCls}
                          value={w.start}
                          onChange={(e) => change((d) => ({ ...d, [n]: rows.map((r, j) => (j === i ? { ...r, start: e.target.value } : r)) }))}
                        />
                        <span className="text-stone-400">to</span>
                        <input
                          aria-label={`${label} closes`}
                          type="time"
                          step={300}
                          className={timeCls}
                          value={w.end}
                          onChange={(e) => change((d) => ({ ...d, [n]: rows.map((r, j) => (j === i ? { ...r, end: e.target.value } : r)) }))}
                        />
                        <button
                          type="button"
                          aria-label={`Remove window ${i + 1} on ${label}`}
                          className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                          onClick={() => change((d) => ({ ...d, [n]: rows.filter((_, j) => j !== i) }))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {rows.length > 0 && (
                      <button
                        type="button"
                        className="text-sm font-medium text-teal-700 hover:underline"
                        onClick={() => change((d) => ({ ...d, [n]: [...rows, { start: "13:00", end: "17:00" }] }))}
                      >
                        + Add window
                      </button>
                    )}
                  </div>

                  {n === 1 && rows.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-stone-600 underline-offset-2 hover:underline"
                      onClick={() =>
                        change((d) => ({ ...d, 2: [...rows], 3: [...rows], 4: [...rows], 5: [...rows] }))
                      }
                    >
                      Copy to Tue–Fri
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {saveError && <Alert>{saveError}</Alert>}
          {saved && <Alert kind="success">Saved. Your booking page now uses these hours.</Alert>}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : "Save hours"}
            </button>
            <button
              onClick={() => {
                if (data) setDraft(toDraft(data.windows));
                setSaved(false);
                setSaveError(null);
              }}
              className={btnSecondary}
            >
              Reset
            </button>
          </div>
        </>
      )}
    </section>
  );
}
