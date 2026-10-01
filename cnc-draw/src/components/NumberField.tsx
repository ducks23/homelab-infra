"use client";

import { useRef, useState } from "react";

export const fmt = (v: number, dp = 4) => (Number.isFinite(v) ? parseFloat(v.toFixed(dp)).toString() : "");

/** Evaluates simple arithmetic like "10 + 2.5" or "3/8" so dimensions can be typed naturally. */
function evaluate(text: string): number {
  const t = text.trim();
  if (!/^[\d\s.+\-*/()]+$/.test(t)) return NaN;
  try {
    const v = Function(`"use strict"; return (${t});`)();
    return typeof v === "number" ? v : NaN;
  } catch {
    return NaN;
  }
}

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}

export function NumberField({ label, value, onChange, min, max, suffix }: Props) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);

  const commit = () => {
    if (text === null || cancelled.current) {
      cancelled.current = false;
      setText(null);
      return;
    }
    const v = evaluate(text);
    setText(null);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-zinc-400">
      {label}
      <div className="flex items-center rounded border border-zinc-700 bg-zinc-900 focus-within:border-sky-500">
        <input
          className="w-full min-w-0 bg-transparent px-2 py-1 font-mono text-sm normal-case tracking-normal text-zinc-100 outline-none"
          value={text ?? fmt(value)}
          onFocus={(e) => {
            setText(fmt(value));
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {suffix && <span className="pr-2 font-mono text-xs normal-case text-zinc-500">{suffix}</span>}
      </div>
    </label>
  );
}
