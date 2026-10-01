"use client";

import type { ReactNode } from "react";

export function HeaderButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800 hover:text-white" />;
}

export function Section({ title, right, grow, children }: { title: string; right?: ReactNode; grow?: boolean; children: ReactNode }) {
  return (
    <section className={`border-b border-zinc-800 p-4 ${grow ? "flex flex-1 flex-col" : ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-zinc-900 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-zinc-200">{value}</div>
    </div>
  );
}
