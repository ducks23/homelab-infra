"use client";

import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { dedupe, dist } from "@/lib/geometry";
import { generateGcode } from "@/lib/gcode";
import {
  allowedOps,
  applyHandle,
  convertUnits,
  getHandles,
  hitTest,
  isClosedShape,
  KIND_LABELS,
  OP_LABELS,
  rectPoints,
  supportsTabs,
  translate,
  uid,
} from "@/lib/shapes";
import { DEFAULT_SETTINGS, type JobSettings, type Operation, type Project, type Pt, type Shape } from "@/lib/types";
import { convertDovetail, DEFAULT_DOVETAIL, type DovetailParams } from "@/lib/dovetail";
import DovetailBuilder from "./DovetailBuilder";
import { fmt, NumberField } from "./NumberField";
import { HeaderButton, Section, Stat } from "./ui";

type Tool = "select" | "line" | "poly" | "rect" | "circle" | "drill" | "pan";
type View = { scale: number; ox: number; oy: number };
type Drag =
  | { mode: "pan"; sx: number; sy: number; view: View }
  | { mode: "move"; start: Pt; orig: Shape; dirty: boolean }
  | { mode: "handle"; index: number; orig: Shape; dirty: boolean }
  | { mode: "draw"; start: Pt };

const STORAGE_KEY = "cnc-draw:project";

const OP_COLORS: Record<Operation, string> = {
  on: "#38bdf8",
  outside: "#34d399",
  inside: "#fbbf24",
  pocket: "#e879f9",
  drill: "#fb7185",
};

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: "select", label: "Select / move", key: "V", icon: icon(<path d="M5 3l14 8-6 2-3 6z" />) },
  { id: "line", label: "Line", key: "L", icon: icon(<path d="M5 19L19 5" />) },
  { id: "poly", label: "Polyline (click points, Enter/double-click to finish, click start to close)", key: "P", icon: icon(<path d="M4 18l5-11 6 7 5-9" />) },
  { id: "rect", label: "Rectangle", key: "R", icon: icon(<rect x="4" y="6" width="16" height="12" rx="0.5" />) },
  { id: "circle", label: "Circle (drag from center)", key: "C", icon: icon(<circle cx="12" cy="12" r="8" />) },
  { id: "drill", label: "Drill point", key: "D", icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /></>) },
  { id: "pan", label: "Pan (or hold Space / middle mouse)", key: "H", icon: icon(<path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3.5 13a1.5 1.5 0 012.5-1.6L8 14" />) },
];

function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}

function fitView(w: number, h: number, s: JobSettings): View {
  const pad = 48;
  const scale = Math.max(0.01, Math.min((w - pad * 2) / s.stockW, (h - pad * 2) / s.stockH));
  return { scale, ox: (w - s.stockW * scale) / 2, oy: h - (h - s.stockH * scale) / 2 };
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CncEditor() {
  const [shapes, setShapes] = useState<Shape[]>(() => loadProject()?.shapes ?? []);
  const [settings, setSettings] = useState<JobSettings>(() => ({ ...DEFAULT_SETTINGS, ...loadProject()?.settings }));
  const [dovetail, setDovetail] = useState<DovetailParams>(() => {
    const saved = loadProject();
    const units = saved?.settings?.units ?? DEFAULT_SETTINGS.units;
    return convertDovetail({ ...DEFAULT_DOVETAIL, ...saved?.dovetail }, units);
  });
  const [mode, setMode] = useState<"sketch" | "dovetail">("sketch");
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [snap, setSnap] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 3, ox: 40, oy: 500 });
  const [copied, setCopied] = useState(false);
  const [panning, setPanning] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const undoStack = useRef<Shape[][]>([]);
  const redoStack = useRef<Shape[][]>([]);
  const settingsRef = useRef(settings);
  const fitted = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, shapes, settings, dovetail } satisfies Project));
    } catch {
      /* storage unavailable – autosave is best effort */
    }
  }, [shapes, settings, dovetail]);

  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setSize({ w, h });
      if (!fitted.current && w > 0 && h > 0) {
        fitted.current = true;
        setView(fitView(w, h, settingsRef.current));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom needs a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setView((v) => {
        const scale = Math.min(500, Math.max(0.05, v.scale * Math.exp(-e.deltaY * 0.0015)));
        const wx = (sx - v.ox) / v.scale;
        const wy = (v.oy - sy) / v.scale;
        return { scale, ox: sx - wx * scale, oy: sy + wy * scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const deferredShapes = useDeferredValue(shapes);
  const deferredSettings = useDeferredValue(settings);
  const result = useMemo(() => generateGcode(deferredShapes, deferredSettings), [deferredShapes, deferredSettings]);

  const selected = shapes.find((s) => s.id === selectedId) ?? null;
  const u = settings.units;

  // ---------- coordinate helpers ----------
  const toScreen = (p: Pt) => ({ x: view.ox + p.x * view.scale, y: view.oy - p.y * view.scale });
  const toWorld = (sx: number, sy: number): Pt => ({ x: (sx - view.ox) / view.scale, y: (view.oy - sy) / view.scale });
  const snapPt = (p: Pt, off: boolean): Pt => {
    if (!snap || off || settings.gridSize <= 0) return p;
    const g = settings.gridSize;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  };
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  // ---------- history ----------
  const pushHistory = () => {
    undoStack.current.push(shapes);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(shapes);
    setShapes(prev);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(shapes);
    setShapes(next);
  };
  const commitShapes = (next: Shape[]) => {
    pushHistory();
    setShapes(next);
  };
  const updateShape = (id: string, fn: (s: Shape) => Shape) => commitShapes(shapes.map((s) => (s.id === id ? fn(s) : s)));

  const newBase = (op: Operation) => ({ id: uid(), op, depth: settings.defaultDepth });

  const chooseTool = (t: Tool) => {
    setDraft(null);
    setTool(t);
    if (t !== "select") setSelectedId(null);
  };

  const addShape = (s: Shape) => {
    commitShapes([...shapes, s]);
    setSelectedId(s.id);
  };

  const finishPoly = (closed: boolean) => {
    if (draft?.kind !== "poly") return;
    const pts = dedupe(draft.points.slice(0, -1), closed);
    setDraft(null);
    if (pts.length < (closed ? 3 : 2)) return;
    addShape({ ...draft, points: pts, closed, op: closed ? "outside" : "on" });
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    commitShapes(shapes.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const g = settings.gridSize || 1;
    addShape({ ...translate(selected, g * 2, -g * 2), id: uid() });
  };

  const fit = () => {
    if (size.w && size.h) setView(fitView(size.w, size.h, settings));
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (mode !== "sketch" || t.closest("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod) return;
      if (e.key === " ") {
        spaceDown.current = true;
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else setSelectedId(null);
        return;
      }
      if (e.key === "Enter") {
        finishPoly(false);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key.startsWith("Arrow") && selected) {
        e.preventDefault();
        const step = (settings.gridSize || 1) * (e.shiftKey ? 10 : 1);
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
        updateShape(selected.id, (s) => translate(s, dx, dy));
        return;
      }
      if (k === "f") {
        fit();
        return;
      }
      const hit = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (hit) chooseTool(hit.id);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // ---------- pointer ----------
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    const { sx, sy } = local(e);
    const raw = toWorld(sx, sy);
    const p = snapPt(raw, e.altKey);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.button === 1 || tool === "pan" || spaceDown.current) {
      dragRef.current = { mode: "pan", sx, sy, view };
      setPanning(true);
      return;
    }

    switch (tool) {
      case "select": {
        if (selected) {
          const idx = getHandles(selected).findIndex((h) => {
            const s = toScreen(h);
            return Math.hypot(s.x - sx, s.y - sy) < 8;
          });
          if (idx >= 0) {
            dragRef.current = { mode: "handle", index: idx, orig: selected, dirty: false };
            return;
          }
        }
        const hit = hitTest(shapes, raw, 6 / view.scale);
        setSelectedId(hit?.id ?? null);
        if (hit) dragRef.current = { mode: "move", start: p, orig: hit, dirty: false };
        return;
      }
      case "line":
        setDraft({ ...newBase("on"), kind: "line", a: p, b: p });
        dragRef.current = { mode: "draw", start: p };
        return;
      case "rect":
        setDraft({ ...newBase("outside"), kind: "rect", x: p.x, y: p.y, w: 0, h: 0 });
        dragRef.current = { mode: "draw", start: p };
        return;
      case "circle":
        setDraft({ ...newBase("outside"), kind: "circle", cx: p.x, cy: p.y, r: 0 });
        dragRef.current = { mode: "draw", start: p };
        return;
      case "poly": {
        if (draft?.kind !== "poly") {
          setDraft({ ...newBase("on"), kind: "poly", points: [p, p], closed: false });
          return;
        }
        const pts = draft.points;
        const first = toScreen(pts[0]);
        if (pts.length >= 4 && (dist(p, pts[0]) < 1e-9 || Math.hypot(first.x - sx, first.y - sy) < 10)) {
          finishPoly(true);
          return;
        }
        if (dist(p, pts[pts.length - 2]) < 1e-9) return;
        setDraft({ ...draft, points: [...pts.slice(0, -1), p, p] });
        return;
      }
      case "drill":
        addShape({ ...newBase("drill"), kind: "drill", x: p.x, y: p.y });
        return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { sx, sy } = local(e);
    const p = snapPt(toWorld(sx, sy), e.altKey);
    setCursor(p);
    const d = dragRef.current;
    if (!d) {
      if (draft?.kind === "poly") setDraft({ ...draft, points: [...draft.points.slice(0, -1), p] });
      return;
    }
    switch (d.mode) {
      case "pan":
        setView({ ...d.view, ox: d.view.ox + sx - d.sx, oy: d.view.oy + sy - d.sy });
        return;
      case "move": {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (!d.dirty && dx === 0 && dy === 0) return;
        if (!d.dirty) {
          pushHistory();
          d.dirty = true;
        }
        setShapes((ss) => ss.map((s) => (s.id === d.orig.id ? translate(d.orig, dx, dy) : s)));
        return;
      }
      case "handle":
        if (!d.dirty) {
          pushHistory();
          d.dirty = true;
        }
        setShapes((ss) => ss.map((s) => (s.id === d.orig.id ? applyHandle(d.orig, d.index, p) : s)));
        return;
      case "draw": {
        const a = d.start;
        if (draft?.kind === "line") setDraft({ ...draft, b: p });
        if (draft?.kind === "rect")
          setDraft({ ...draft, x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
        if (draft?.kind === "circle") setDraft({ ...draft, r: dist(a, p) });
        return;
      }
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    if (d?.mode !== "draw" || !draft) return;
    setDraft(null);
    const ok =
      (draft.kind === "line" && dist(draft.a, draft.b) > 1e-6) ||
      (draft.kind === "rect" && draft.w > 1e-6 && draft.h > 1e-6) ||
      (draft.kind === "circle" && draft.r > 1e-6);
    if (ok) addShape(draft);
  };

  // ---------- project ----------
  const setUnits = (to: JobSettings["units"]) => {
    const conv = convertUnits(shapes, settings, to);
    commitShapes(conv.shapes);
    setSettings(conv.settings);
    setDovetail((d) => convertDovetail(d, to));
    if (size.w) setView(fitView(size.w, size.h, conv.settings));
  };

  const openProject = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (!Array.isArray(p.shapes)) throw new Error("missing shapes");
      commitShapes(p.shapes);
      const next = { ...DEFAULT_SETTINGS, ...p.settings };
      setSettings(next);
      setDovetail(convertDovetail({ ...DEFAULT_DOVETAIL, ...p.dovetail }, next.units));
      setSelectedId(null);
      if (size.w) setView(fitView(size.w, size.h, next));
    } catch (err) {
      alert(`Could not open project: ${(err as Error).message}`);
    }
  };

  const set = <K extends keyof JobSettings>(k: K) => (v: JobSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  // ---------- rendering ----------
  const grid = useMemo(() => {
    if (!size.w || settings.gridSize <= 0) return { minor: "", major: "" };
    let g = settings.gridSize;
    while (g * view.scale < 8) g *= 5;
    const x0 = Math.floor(-view.ox / view.scale / g) * g;
    const x1 = (size.w - view.ox) / view.scale;
    const y0 = Math.floor((view.oy - size.h) / view.scale / g) * g;
    const y1 = view.oy / view.scale;
    let minor = "";
    let major = "";
    const isMajor = (v: number) => Math.abs(v / (g * 5) - Math.round(v / (g * 5))) < 1e-6;
    for (let x = x0; x <= x1; x += g) {
      const sx = (view.ox + x * view.scale).toFixed(1);
      const seg = `M${sx} 0V${size.h}`;
      if (isMajor(x)) major += seg;
      else minor += seg;
    }
    for (let y = y0; y <= y1; y += g) {
      const sy = (view.oy - y * view.scale).toFixed(1);
      const seg = `M0 ${sy}H${size.w}`;
      if (isMajor(y)) major += seg;
      else minor += seg;
    }
    return { minor, major };
  }, [size, view, settings.gridSize]);

  const ptsAttr = (pts: Pt[]) =>
    pts
      .map((p) => {
        const s = toScreen(p);
        return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      })
      .join(" ");

  const renderShape = (s: Shape, opts: { selected?: boolean; draft?: boolean } = {}) => {
    const color = OP_COLORS[s.op];
    const common = {
      stroke: opts.selected ? "#ffffff" : color,
      strokeWidth: opts.selected ? 2.25 : 1.5,
      strokeDasharray: opts.draft ? "6 4" : undefined,
      fill: s.op === "pocket" ? `${color}22` : isClosedShape(s) ? "transparent" : "none",
    };
    switch (s.kind) {
      case "line":
        return <polyline key={s.id} points={ptsAttr([s.a, s.b])} {...common} />;
      case "poly":
        return s.closed ? (
          <polygon key={s.id} points={ptsAttr(s.points)} {...common} />
        ) : (
          <polyline key={s.id} points={ptsAttr(s.points)} {...common} />
        );
      case "rect":
        return <polygon key={s.id} points={ptsAttr(rectPoints(s))} {...common} />;
      case "circle": {
        const c = toScreen({ x: s.cx, y: s.cy });
        return <circle key={s.id} cx={c.x} cy={c.y} r={s.r * view.scale} {...common} />;
      }
      case "drill": {
        const c = toScreen({ x: s.x, y: s.y });
        const r = Math.max(4, (settings.toolDiameter / 2) * view.scale);
        return (
          <g key={s.id} {...common} fill="none">
            <circle cx={c.x} cy={c.y} r={r} />
            <path d={`M${c.x - r - 4} ${c.y}H${c.x + r + 4}M${c.x} ${c.y - r - 4}V${c.y + r + 4}`} strokeWidth={1} />
          </g>
        );
      }
    }
  };

  const stockA = toScreen({ x: 0, y: settings.stockH });
  const origin = toScreen({ x: 0, y: 0 });
  const cursorClass = panning ? "cursor-grabbing" : tool === "pan" ? "cursor-grab" : tool === "select" ? "cursor-default" : "cursor-crosshair";
  const minutes = result.stats.minutes;

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="font-semibold tracking-tight">
          CNC <span className="text-sky-400">Draw</span>
        </h1>
        <div className="ml-4 flex gap-1 rounded bg-zinc-900 p-0.5 text-sm">
          {(
            [
              ["sketch", "Sketch"],
              ["dovetail", "Dovetail drawer"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 ${mode === m ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {mode === "sketch" && (
            <>
              <HeaderButton onClick={undo} title="Undo (⌘Z)">Undo</HeaderButton>
              <HeaderButton onClick={redo} title="Redo (⇧⌘Z)">Redo</HeaderButton>
              <span className="mx-1 h-5 w-px bg-zinc-800" />
              <HeaderButton
                onClick={() => {
                  commitShapes([]);
                  setSelectedId(null);
                }}
                title="Clear all shapes (undoable)"
              >
                New
              </HeaderButton>
            </>
          )}
          <HeaderButton onClick={() => fileRef.current?.click()}>Open…</HeaderButton>
          <HeaderButton onClick={() => download("project.cncdraw.json", JSON.stringify({ version: 1, shapes, settings, dovetail }, null, 2), "application/json")}>
            Save project
          </HeaderButton>
          {mode === "sketch" && (
            <button
              className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500"
              onClick={() => download("program.nc", result.gcode, "text/plain")}
            >
              Download .nc
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openProject(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {mode === "dovetail" && <DovetailBuilder params={dovetail} onChange={setDovetail} onUnits={setUnits} />}
      <div className={`min-h-0 flex-1 ${mode === "sketch" ? "flex" : "hidden"}`}>
        {/* tool rail */}
        <nav className="flex w-12 flex-col items-center gap-1 border-r border-zinc-800 py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => chooseTool(t.id)}
              className={`flex h-9 w-9 items-center justify-center rounded ${
                tool === t.id ? "bg-sky-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {t.icon}
            </button>
          ))}
          <div className="my-1 h-px w-7 bg-zinc-800" />
          <button title="Fit stock to view (F)" onClick={fit} className="flex h-9 w-9 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            {icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />)}
          </button>
        </nav>

        {/* canvas */}
        <main className="relative min-w-0 flex-1">
          <svg
            ref={svgRef}
            className={`absolute inset-0 h-full w-full touch-none select-none ${cursorClass}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onDoubleClick={() => finishPoly(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <path d={grid.minor} stroke="#27272a" strokeWidth={1} />
            <path d={grid.major} stroke="#3f3f46" strokeWidth={1} />

            <rect
              x={stockA.x}
              y={stockA.y}
              width={settings.stockW * view.scale}
              height={settings.stockH * view.scale}
              fill="#a1620710"
              stroke="#a16207"
              strokeWidth={1.5}
            />

            {/* origin */}
            <path d={`M${origin.x} ${origin.y}h28`} stroke="#ef4444" strokeWidth={2} />
            <path d={`M${origin.x} ${origin.y}v-28`} stroke="#22c55e" strokeWidth={2} />
            <text x={origin.x + 30} y={origin.y + 4} fill="#ef4444" fontSize={11}>X</text>
            <text x={origin.x - 4} y={origin.y - 32} fill="#22c55e" fontSize={11}>Y</text>

            {showPaths && (
              <g opacity={0.18} stroke="#f97316" fill="none" strokeLinecap="round" strokeLinejoin="round">
                {result.preview.map((c) =>
                  c.lines.map((l, i) => <polyline key={`${c.shapeId}-b${i}`} points={ptsAttr(l)} strokeWidth={settings.toolDiameter * view.scale} />),
                )}
                {result.preview.map((c) =>
                  c.drills.map((p, i) => {
                    const s = toScreen(p);
                    return <circle key={`${c.shapeId}-d${i}`} cx={s.x} cy={s.y} r={(settings.toolDiameter / 2) * view.scale} fill="#f97316" stroke="none" />;
                  }),
                )}
              </g>
            )}

            {shapes.map((s) => renderShape(s, { selected: s.id === selectedId }))}

            {showPaths && (
              <g stroke="#f97316" fill="none" strokeWidth={1} strokeDasharray="4 3">
                {result.preview.map((c) => c.lines.map((l, i) => <polyline key={`${c.shapeId}-l${i}`} points={ptsAttr(l)} />))}
              </g>
            )}
            {showPaths && (
              <g stroke="#22d3ee" fill="none" strokeWidth={5} strokeLinecap="butt">
                {result.preview.map((c) => c.tabs.map((l, i) => <polyline key={`${c.shapeId}-t${i}`} points={ptsAttr(l)} />))}
              </g>
            )}

            {selected &&
              getHandles(selected).map((h, i) => {
                const s = toScreen(h);
                return <rect key={i} x={s.x - 4} y={s.y - 4} width={8} height={8} fill="#0ea5e9" stroke="#fff" strokeWidth={1} />;
              })}

            {draft && renderShape(draft, { draft: true })}
            {draft?.kind === "poly" && draft.points.length >= 4 && (() => {
              const s = toScreen(draft.points[0]);
              return <circle cx={s.x} cy={s.y} r={6} fill="none" stroke="#fff" strokeWidth={1} />;
            })()}

            {cursor && tool !== "select" && tool !== "pan" && (() => {
              const s = toScreen(cursor);
              return <circle cx={s.x} cy={s.y} r={3} fill="#fff" />;
            })()}
          </svg>

          {/* status bar */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex gap-4 bg-zinc-950/80 px-3 py-1 font-mono text-xs text-zinc-400">
            <span>
              X {cursor ? fmt(cursor.x, 3) : "–"} Y {cursor ? fmt(cursor.y, 3) : "–"} {u}
            </span>
            <span>zoom {fmt(view.scale, 2)} px/{u}</span>
            <span className="ml-auto">
              {tool === "poly"
                ? "Click to add points · click first point to close · Enter / double-click to finish · Esc to cancel"
                : "Scroll to zoom · Space+drag to pan · Alt to disable snap · Arrows nudge · ⌘D duplicate"}
            </span>
          </div>
        </main>

        {/* sidebar */}
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800">
          <Section title={selected ? `#${shapes.indexOf(selected) + 1} ${KIND_LABELS[selected.kind]}` : "Shapes"}>
            {selected ? (
              <ShapeProperties
                shape={selected}
                units={u}
                onChange={(fn) => updateShape(selected.id, fn)}
                onDelete={deleteSelected}
                onDuplicate={duplicateSelected}
              />
            ) : shapes.length ? (
              <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-sm">
                {shapes.map((s, i) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        setTool("select");
                        setSelectedId(s.id);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-800"
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: OP_COLORS[s.op] }} />
                      <span className="text-zinc-500">#{i + 1}</span>
                      {KIND_LABELS[s.kind]}
                      <span className="ml-auto text-xs text-zinc-500">
                        {s.op} · {fmt(s.depth)} {u}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Pick a tool on the left and draw on the stock. Select a shape to edit its dimensions and cut settings.</p>
            )}
          </Section>

          <Section title="Job setup">
            <div className="mb-3 flex gap-1 rounded bg-zinc-900 p-0.5 text-sm">
              {(["mm", "in"] as const).map((un) => (
                <button
                  key={un}
                  onClick={() => setUnits(un)}
                  className={`flex-1 rounded py-1 ${u === un ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-100"}`}
                >
                  {un === "mm" ? "Millimeters (G21)" : "Inches (G20)"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Stock W" value={settings.stockW} onChange={set("stockW")} min={0.001} suffix={u} />
              <NumberField label="Stock H" value={settings.stockH} onChange={set("stockH")} min={0.001} suffix={u} />
              <NumberField label="Thickness" value={settings.stockT} onChange={set("stockT")} min={0.001} suffix={u} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberField label="Tool diameter" value={settings.toolDiameter} onChange={set("toolDiameter")} min={0.001} suffix={u} />
              <NumberField label="Spindle" value={settings.spindleRpm} onChange={set("spindleRpm")} min={0} suffix="rpm" />
              <NumberField label="Feed rate" value={settings.feedRate} onChange={set("feedRate")} min={0.001} suffix={`${u}/min`} />
              <NumberField label="Plunge rate" value={settings.plungeRate} onChange={set("plungeRate")} min={0.001} suffix={`${u}/min`} />
              <NumberField label="Depth per pass" value={settings.passDepth} onChange={set("passDepth")} min={0.001} suffix={u} />
              <NumberField label="Safe Z" value={settings.safeZ} onChange={set("safeZ")} min={0} suffix={u} />
              <NumberField label="Pocket stepover" value={settings.stepover} onChange={set("stepover")} min={5} max={95} suffix="%" />
              <NumberField label="Default depth" value={settings.defaultDepth} onChange={set("defaultDepth")} min={0} suffix={u} />
              <NumberField label="Tab width" value={settings.tabWidth} onChange={set("tabWidth")} min={0.001} suffix={u} />
              <NumberField label="Tab height" value={settings.tabHeight} onChange={set("tabHeight")} min={0.001} suffix={u} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.climb} onChange={(e) => set("climb")(e.target.checked)} />
                Climb milling
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} />
                Show toolpaths
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                Snap
              </label>
              <div className="w-24">
                <NumberField label="Grid" value={settings.gridSize} onChange={set("gridSize")} min={0} suffix={u} />
              </div>
            </div>
          </Section>

          <Section
            title="G-code"
            right={
              <button
                className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800"
                onClick={async () => {
                  await navigator.clipboard.writeText(result.gcode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            }
            grow
          >
            <div className="mb-2 grid grid-cols-3 gap-2 text-center text-xs">
              <Stat label="Lines" value={String(result.stats.lines)} />
              <Stat label="Cut length" value={`${fmt(result.stats.cutLength, 1)} ${u}`} />
              <Stat label="Est. time" value={minutes < 1 ? `${Math.round(minutes * 60)} s` : `${Math.floor(minutes)}m ${Math.round((minutes % 1) * 60)}s`} />
            </div>
            {result.warnings.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1 rounded border border-amber-700/50 bg-amber-950/40 p-2 text-xs text-amber-300">
                {result.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <textarea
              readOnly
              spellCheck={false}
              value={result.gcode}
              className="min-h-64 w-full flex-1 resize-none rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs leading-5 text-zinc-300 outline-none"
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function ShapeProperties({
  shape,
  units,
  onChange,
  onDelete,
  onDuplicate,
}: {
  shape: Shape;
  units: string;
  onChange: (fn: (s: Shape) => Shape) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const f = <K extends string>(label: string, key: K, value: number, min?: number) => (
    <NumberField
      key={key}
      label={label}
      value={value}
      min={min}
      suffix={units}
      onChange={(v) => onChange((s) => ({ ...s, [key]: v }) as Shape)}
    />
  );
  const pt = (label: string, p: Pt, set: (p: Pt) => Shape) => (
    <>
      <NumberField label={`${label} X`} value={p.x} suffix={units} onChange={(x) => onChange(() => set({ ...p, x }))} />
      <NumberField label={`${label} Y`} value={p.y} suffix={units} onChange={(y) => onChange(() => set({ ...p, y }))} />
    </>
  );

  let geometry: ReactNode = null;
  switch (shape.kind) {
    case "line":
      geometry = (
        <>
          {pt("Start", shape.a, (a) => ({ ...shape, a }))}
          {pt("End", shape.b, (b) => ({ ...shape, b }))}
        </>
      );
      break;
    case "rect":
      geometry = (
        <>
          {f("X", "x", shape.x)}
          {f("Y", "y", shape.y)}
          {f("Width", "w", shape.w, 0.001)}
          {f("Height", "h", shape.h, 0.001)}
        </>
      );
      break;
    case "circle":
      geometry = (
        <>
          {f("Center X", "cx", shape.cx)}
          {f("Center Y", "cy", shape.cy)}
          <NumberField label="Diameter" value={shape.r * 2} min={0.001} suffix={units} onChange={(d) => onChange((s) => ({ ...s, r: d / 2 }) as Shape)} />
        </>
      );
      break;
    case "drill":
      geometry = (
        <>
          {f("X", "x", shape.x)}
          {f("Y", "y", shape.y)}
        </>
      );
      break;
    case "poly":
      geometry = null;
      break;
  }

  const ops = allowedOps(shape);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-zinc-400">
        Operation
        <select
          value={shape.op}
          onChange={(e) => onChange((s) => ({ ...s, op: e.target.value as Operation }))}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm normal-case tracking-normal text-zinc-100"
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABELS[o]}
            </option>
          ))}
        </select>
      </label>
      <NumberField label="Cut depth" value={shape.depth} min={0} suffix={units} onChange={(depth) => onChange((s) => ({ ...s, depth }))} />
      {supportsTabs(shape) && (
        <NumberField
          label="Holding tabs (0 = none)"
          value={shape.tabs ?? 0}
          min={0}
          max={32}
          onChange={(tabs) => onChange((s) => ({ ...s, tabs: Math.round(tabs) }))}
        />
      )}

      {geometry && <div className="grid grid-cols-2 gap-2">{geometry}</div>}

      {shape.kind === "poly" && (
        <>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={shape.closed}
              disabled={shape.points.length < 3}
              onChange={(e) =>
                onChange((s) => {
                  const closed = e.target.checked;
                  const next = { ...s, closed } as Shape;
                  return { ...next, op: allowedOps(next).includes(s.op) ? s.op : closed ? "outside" : "on" };
                })
              }
            />
            Closed shape
          </label>
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
            {shape.points.map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                {pt(`P${i + 1}`, p, (np) => ({ ...shape, points: shape.points.map((q, j) => (j === i ? np : q)) }))}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-2">
        <button onClick={onDuplicate} className="flex-1 rounded border border-zinc-700 py-1 text-sm hover:bg-zinc-800">
          Duplicate
        </button>
        <button onClick={onDelete} className="flex-1 rounded border border-red-900 py-1 text-sm text-red-300 hover:bg-red-950">
          Delete
        </button>
      </div>
    </div>
  );
}
