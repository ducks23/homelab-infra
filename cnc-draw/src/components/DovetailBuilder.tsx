"use client";

import { type ReactNode, useMemo, useState } from "react";
import { type DovetailParams, generateDovetail, type Layout, recommend } from "@/lib/dovetail";
import type { Pt, Units } from "@/lib/types";
import { fmt, NumberField } from "./NumberField";
import { Section, Stat } from "./ui";

const WOOD = "#a16207";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const pts = (list: Pt[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

interface Props {
  params: DovetailParams;
  onChange: (p: DovetailParams) => void;
  onUnits: (u: Units) => void;
}

export default function DovetailBuilder({ params: p, onChange, onUnits }: Props) {
  const rec = useMemo(() => recommend(p), [p]);
  const res = useMemo(() => generateDovetail(p), [p]);
  const [program, setProgram] = useState<"tail" | "pin">("tail");
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof DovetailParams>(k: K) => (v: DovetailParams[K]) => onChange({ ...p, [k]: v });
  const u = p.units;
  const lay = res.layout;
  const d = (v: number) => `${fmt(v, u === "in" ? 3 : 2)}`;
  const gcode = program === "tail" ? res.tailGcode : res.pinGcode;
  const ok = !lay.problems.length;

  return (
    <div className="flex min-h-0 flex-1">
      {/* inputs */}
      <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-zinc-800">
        <Section title="Units">
          <div className="flex gap-1 rounded bg-zinc-900 p-0.5 text-sm">
            {(["mm", "in"] as const).map((un) => (
              <button
                key={un}
                onClick={() => onUnits(un)}
                className={`flex-1 rounded py-1 ${u === un ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-100"}`}
              >
                {un === "mm" ? "Millimeters" : "Inches"}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Drawer (outside dimensions)">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Width" value={p.drawerWidth} onChange={set("drawerWidth")} min={0.01} suffix={u} />
            <NumberField label="Depth" value={p.drawerDepth} onChange={set("drawerDepth")} min={0.01} suffix={u} />
            <NumberField label="Height" value={p.drawerHeight} onChange={set("drawerHeight")} min={0.01} suffix={u} />
            <div />
            <NumberField label="Side thick." value={p.sideThickness} onChange={set("sideThickness")} min={0.01} suffix={u} />
            <NumberField label="Front/back thick." value={p.frontThickness} onChange={set("frontThickness")} min={0.01} suffix={u} />
          </div>
        </Section>
        <Section title="Dovetail bit (tails)">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Diameter (tip)" value={p.dtDiameter} onChange={set("dtDiameter")} min={0.01} suffix={u} />
            <NumberField label="Angle" value={p.dtAngle} onChange={set("dtAngle")} min={1} max={30} suffix="°" />
            <NumberField label="Cutting length" value={p.dtCutLength} onChange={set("dtCutLength")} min={0.01} suffix={u} />
          </div>
        </Section>
        <Section title="Straight bit (pins)">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Diameter" value={p.straightDiameter} onChange={set("straightDiameter")} min={0.01} suffix={u} />
          </div>
        </Section>
        <Section title="Joint layout">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Pin width" value={p.pinWidth} onChange={set("pinWidth")} min={0.01} suffix={u} />
            <NumberField label="Half-pin width" value={p.halfPinWidth} onChange={set("halfPinWidth")} min={0.01} suffix={u} />
            <NumberField label="Tail : pin target" value={p.ratio} onChange={set("ratio")} min={0.5} max={10} suffix=": 1" />
            <NumberField label="Fit clearance" value={p.fit} onChange={set("fit")} min={0} suffix={u} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Pin widths are measured at the baseline (the inside face of the front). Pins must be at least as wide as the dovetail bit; wider
            pins take extra passes. Fit clearance widens the sockets in the front and back. Increase it if test joints are too tight.
          </p>
        </Section>
        <Section title="Feeds & speeds">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Dovetail feed" value={p.dtFeed} onChange={set("dtFeed")} min={0.01} suffix={`${u}/min`} />
            <NumberField label="Straight feed" value={p.feedRate} onChange={set("feedRate")} min={0.01} suffix={`${u}/min`} />
            <NumberField label="Plunge rate" value={p.plungeRate} onChange={set("plungeRate")} min={0.01} suffix={`${u}/min`} />
            <NumberField label="Spindle" value={p.spindleRpm} onChange={set("spindleRpm")} min={0} suffix="rpm" />
            <NumberField label="Depth / pass (pins)" value={p.passDepth} onChange={set("passDepth")} min={0.01} suffix={u} />
            <NumberField label="Safe Z" value={p.safeZ} onChange={set("safeZ")} min={0} suffix={u} />
          </div>
        </Section>
      </aside>

      {/* diagrams */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 grid grid-cols-2 gap-2 text-center text-xs lg:grid-cols-4">
          <Stat label="Tails" value={`${lay.n}${p.tails ? "" : " (auto)"}`} />
          <Stat label="Pins" value={`${lay.n - 1} + 2 half`} />
          <Stat label="Tail base / end" value={`${d(lay.tail)} / ${d(lay.tailEnd)} ${u}`} />
          <Stat label="Pin base / end" value={`${d(lay.pin)} / ${d(lay.pinEnd)} ${u}`} />
        </div>

        {res.warnings.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1 rounded border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-300">
            {res.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
            {!ok && <li className="text-amber-400/80">No toolpaths are generated until these are fixed.</li>}
          </ul>
        )}

        <Figure title="Drawer side (tail board): face view of the joint end" note="Orange shows the dovetail bit's passes. Each one sweeps through the board thickness (Y).">
          <TailFace p={p} lay={lay} passes={res.tailPasses} />
        </Figure>

        <Figure title="Drawer front/back (pin board): end-grain view from above" note="Tail sockets are cut with the straight bit. The dashed orange lines are the tool center paths.">
          <PinEnd p={p} lay={lay} paths={res.pinPaths} />
        </Figure>

        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Cut list</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-1 font-normal">Part</th>
                  <th className="font-normal">Qty</th>
                  <th className="font-normal">L × W × T ({u})</th>
                  <th className="font-normal">Joint</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs text-zinc-300">
                <tr className="border-t border-zinc-800">
                  <td className="py-1.5 font-sans">Sides</td>
                  <td>2</td>
                  <td>
                    {d(p.drawerDepth)} × {d(p.drawerHeight)} × {d(p.sideThickness)}
                  </td>
                  <td className="font-sans">tails, both ends</td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-1.5 font-sans">Front / back</td>
                  <td>2</td>
                  <td>
                    {d(p.drawerWidth)} × {d(p.drawerHeight)} × {d(p.frontThickness)}
                  </td>
                  <td className="font-sans">pins, both ends</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-zinc-500">
              Inside: {d(p.drawerWidth - 2 * p.sideThickness)} × {d(p.drawerDepth - 2 * p.frontThickness)} {u}. Cut the drawer-bottom groove
              separately, and keep it inside a tail so it&apos;s hidden.
            </p>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Vertical workholding setup</h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
              <li>
                Clamp the board <b>vertically</b> at the front of the machine, end grain up, with its <b>inside face against a sacrificial
                backer</b> and the outside face toward you (−Y).
              </li>
              <li>
                Zero <b>X</b> on the board&apos;s left edge, <b>Y</b> on the outside face, <b>Z</b> on the top end. Keep clamps more than{" "}
                {d(Math.max(p.frontThickness, p.sideThickness) + p.dtDiameter)} {u} below the end.
              </li>
              <li>
                <b>Sides:</b> dovetail bit, run the <i>tail</i> program on both ends of both sides (4×). The bit goes to full depth in front of
                the board, sweeps through into the backer, and comes back out the same way.
              </li>
              <li>
                <b>Front &amp; back:</b> straight bit, run the <i>pin</i> program 4×. Keep the inside face against the backer.
              </li>
              <li>The layout is symmetric, so flip each board end-for-end with the outside face still toward you.</li>
              <li>Cut a test joint in scrap first and adjust <i>Fit clearance</i> until it goes together with light mallet taps.</li>
            </ol>
          </div>
        </div>
      </main>

      {/* recommendations + programs */}
      <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800">
        <Section
          title="How many tails?"
          right={
            <button
              onClick={() => set("tails")(0)}
              className={`rounded border px-2 py-0.5 text-xs ${p.tails ? "border-zinc-700 hover:bg-zinc-800" : "border-sky-600 bg-sky-600/20 text-sky-300"}`}
            >
              Auto ({rec.best})
            </button>
          }
        >
          <table className="w-full text-xs">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Tails</th>
                <th className="font-normal">Tail base / end</th>
                <th className="font-normal">Ratio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rec.options.map((o) => {
                const chosen = o.n === lay.n;
                return (
                  <tr
                    key={o.n}
                    onClick={() => set("tails")(o.n)}
                    title={o.problems.join("\n") || "Click to use this layout"}
                    className={`cursor-pointer border-t border-zinc-800 ${chosen ? "bg-sky-600/20" : "hover:bg-zinc-800/60"} ${
                      o.problems.length ? "text-zinc-600" : "text-zinc-300"
                    }`}
                  >
                    <td className="py-1.5 pl-1 font-mono">{o.n}</td>
                    <td className="font-mono">
                      {d(o.tail)} / {d(o.tailEnd)}
                    </td>
                    <td className="font-mono">{fmt(o.tail / o.pin, 2)}:1</td>
                    <td className="pr-1 text-right">
                      {o.problems.length ? "✕" : o.n === rec.best ? <span className="text-emerald-400">recommended</span> : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-zinc-500">
            The recommended layout is the one whose tails come closest to {fmt(p.ratio)}× the pin width while every pin, half pin, and socket
            can still be cut with your bits.
          </p>
        </Section>

        <Section
          title="G-code"
          grow
          right={
            <button
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800"
              onClick={async () => {
                await navigator.clipboard.writeText(gcode);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          }
        >
          <div className="mb-2 flex gap-1 rounded bg-zinc-900 p-0.5 text-sm">
            {(
              [
                ["tail", "Tail boards (sides)"],
                ["pin", "Pin boards (front/back)"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setProgram(k)}
                className={`flex-1 rounded py-1 ${program === k ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-2 flex gap-2">
            <button
              disabled={!ok}
              onClick={() => download("drawer-tails.nc", res.tailGcode)}
              className="flex-1 rounded bg-sky-600 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              Download tails .nc
            </button>
            <button
              disabled={!ok}
              onClick={() => download("drawer-pins.nc", res.pinGcode)}
              className="flex-1 rounded bg-sky-600 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              Download pins .nc
            </button>
          </div>
          <textarea
            readOnly
            spellCheck={false}
            value={gcode}
            className="min-h-64 w-full flex-1 resize-none rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs leading-5 text-zinc-300 outline-none"
          />
        </Section>
      </aside>
    </div>
  );
}

function Figure({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <figure className="mb-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <figcaption className="mb-3">
        <div className="text-sm font-medium text-zinc-200">{title}</div>
        <div className="text-xs text-zinc-500">{note}</div>
      </figcaption>
      {children}
    </figure>
  );
}

/** Tail board face: x along the board width, y = distance down from the board end. */
function TailFace({ p, lay, passes }: { p: DovetailParams; lay: Layout; passes: number[] }) {
  const { W, L, k, tails } = lay;
  const depthShown = L * 2;
  const m = Math.max(W * 0.06, p.dtDiameter);
  const fs = W / 45;
  const R = p.dtDiameter / 2;
  const top = p.dtDiameter - 2 * k;

  const outline: Pt[] = [
    { x: 0, y: depthShown },
    { x: 0, y: L },
  ];
  if (lay.tail > 0) {
    for (const [a, b] of tails) {
      outline.push({ x: a, y: L }, { x: a - k, y: 0 }, { x: b + k, y: 0 }, { x: b, y: L });
    }
  }
  outline.push({ x: W, y: L }, { x: W, y: depthShown });

  return (
    <svg viewBox={`${-m} ${-m - fs * 2} ${W + 2 * m} ${depthShown + 2 * m + fs * 2}`} className="max-h-72 w-full">
      <polygon points={pts(outline)} fill={`${WOOD}55`} stroke={WOOD} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={-m / 2} x2={W + m / 2} y1={L} y2={L} stroke="#71717a" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={W + m / 2} y={L - fs * 0.4} fontSize={fs} fill="#a1a1aa" textAnchor="end">
        baseline
      </text>
      {lay.problems.length === 0 &&
        passes.map((c, i) => (
          <polygon
            key={i}
            points={pts([
              { x: c - R, y: L },
              { x: c + R, y: L },
              { x: c + top / 2, y: 0 },
              { x: c + top / 2, y: -m * 0.6 },
              { x: c - top / 2, y: -m * 0.6 },
              { x: c - top / 2, y: 0 },
            ])}
            fill="#f9731622"
            stroke="#f97316"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {lay.tail > 0 &&
        tails.map(([a, b], i) => (
          <text key={i} x={(a + b) / 2} y={L * 0.55} fontSize={fs} fill="#fde68a" textAnchor="middle">
            {fmt(b - a, 2)}
          </text>
        ))}
      <text x={0} y={-m - fs * 0.6} fontSize={fs} fill="#a1a1aa">
        end of board (Z0) · X0 at left edge · width {fmt(W, 2)} {p.units}
      </text>
    </svg>
  );
}

/** Pin board end grain: x along the board width, y through the thickness (outside face at the top). */
function PinEnd({ p, lay, paths }: { p: DovetailParams; lay: Layout; paths: Pt[][] }) {
  const { W, k, tails } = lay;
  const T = p.frontThickness;
  const m = Math.max(W * 0.06, p.straightDiameter * 2);
  const fs = W / 45;
  const backer = T * 0.6;

  return (
    <svg viewBox={`${-m} ${-m - fs} ${W + 2 * m} ${T + backer + 2 * m + fs}`} className="max-h-60 w-full">
      <rect x={-m / 2} y={T} width={W + m} height={backer} fill="#52525b55" stroke="#52525b" vectorEffect="non-scaling-stroke" />
      <text x={W / 2} y={T + backer / 2 + fs / 3} fontSize={fs} fill="#a1a1aa" textAnchor="middle">
        sacrificial backer (inside face side, +Y)
      </text>
      <rect x={0} y={0} width={W} height={T} fill={`${WOOD}55`} stroke={WOOD} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {lay.tail > 0 &&
        tails.map(([x0, x1], i) => (
          <polygon
            key={i}
            points={pts([
              { x: x0 - k - p.fit, y: 0 },
              { x: x1 + k + p.fit, y: 0 },
              { x: x1 + p.fit, y: T },
              { x: x0 - p.fit, y: T },
            ])}
            fill="#09090b"
            stroke={WOOD}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      <g fill="none" stroke="#f97316" strokeDasharray="3 2" strokeWidth={1}>
        {paths.map((l, i) => (
          <polyline key={i} points={pts(l)} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <text x={0} y={-fs * 0.6} fontSize={fs} fill="#a1a1aa">
        outside face (Y0, toward you) · thickness {fmt(T, 2)} {p.units}
      </text>
    </svg>
  );
}
