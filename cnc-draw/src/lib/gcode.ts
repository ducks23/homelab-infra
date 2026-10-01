import {
  arcSweep,
  circlePath,
  dedupe,
  dist,
  isClosed,
  offsetPolygon,
  type Path,
  pathLength,
  type Piece,
  polylinePath,
  reversePath,
  samplePath,
  signedArea,
  splitPath,
} from "./geometry";
import { KIND_LABELS, rectPoints, supportsTabs } from "./shapes";
import type { JobSettings, Operation, Pt, Shape } from "./types";

type Cut =
  | { type: "mill"; shape: Shape; index: number; paths: Path[] }
  | { type: "drill"; shape: Shape; index: number; at: Pt };

export interface PreviewCut {
  shapeId: string;
  /** Tool-center polylines in world coordinates, including moves between pocket loops. */
  lines: Pt[][];
  drills: Pt[];
  /** Stretches of the path where the tool lifts over a holding tab. */
  tabs: Pt[][];
}

export interface GcodeResult {
  gcode: string;
  preview: PreviewCut[];
  warnings: string[];
  stats: { lines: number; cutLength: number; minutes: number };
}

/** Machining order: holes and interior features before cutting parts free. */
const OP_ORDER: Record<Operation, number> = { drill: 0, pocket: 1, inside: 2, on: 3, outside: 4 };

type Outline = { kind: "poly"; pts: Pt[] } | { kind: "circle"; c: Pt; r: number };

function outlineOf(s: Shape): Outline | null {
  if (s.kind === "rect") return { kind: "poly", pts: rectPoints(s) };
  if (s.kind === "circle") return { kind: "circle", c: { x: s.cx, y: s.cy }, r: s.r };
  if (s.kind === "poly" && s.closed) return { kind: "poly", pts: dedupe(s.points, true) };
  return null;
}

function orientPath(path: Path, cw: boolean): Path {
  // Paths from offsetPolygon / ccw polylines are counter-clockwise.
  return cw ? reversePath(path) : path;
}

function ccwPoints(pts: Pt[]): Pt[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

/**
 * Concentric offset rings clearing a polygon, innermost first so each ring
 * steps outward into material. Returns null if the tool doesn't fit at all.
 */
export function pocketPolygon(pts: Pt[], toolRadius: number, step: number, cw: boolean, warn: (m: string) => void): Path[] | null {
  let d = toolRadius;
  let lastD = -1;
  const rings: Path[] = [];
  while (rings.length < 5000) {
    const p = offsetPolygon(pts, -d);
    if (!p) break;
    rings.push(p);
    lastD = d;
    d += step;
  }
  if (!rings.length) return null;
  // Squeeze in one more ring as deep as possible so the middle is cleared.
  let lo = lastD;
  let hi = lastD + step;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (offsetPolygon(pts, -mid)) lo = mid;
    else hi = mid;
  }
  if (lo - lastD > step * 0.05) {
    const p = offsetPolygon(pts, -lo);
    if (p) rings.push(p);
  }
  // If the innermost ring still encloses a wide region, the offset split into
  // separate lobes (concave shape) and the middle of those lobes stays uncut.
  const inner = samplePath(rings[rings.length - 1]);
  let perim = 0;
  for (let i = 1; i < inner.length; i++) perim += dist(inner[i - 1], inner[i]);
  if (perim > 0 && (2 * signedArea(inner)) / perim > toolRadius * 2 * 1.05) {
    warn("concave pocket could only be partly cleared – split it into simpler shapes.");
  }
  return rings.reverse().map((r) => orientPath(r, cw));
}

function buildCut(shape: Shape, index: number, s: JobSettings, warn: (m: string) => void): Cut | null {
  const name = `#${index} ${KIND_LABELS[shape.kind]}`;
  const tr = s.toolDiameter / 2;
  const step = (s.toolDiameter * Math.min(Math.max(s.stepover, 5), 95)) / 100;
  // With a clockwise spindle, climb milling runs clockwise around the outside and counter-clockwise inside.
  const outsideCw = s.climb;
  const insideCw = !s.climb;

  if (shape.kind === "drill") return { type: "drill", shape, index, at: { x: shape.x, y: shape.y } };

  if (shape.kind === "line") {
    return { type: "mill", shape, index, paths: [polylinePath([shape.a, shape.b], false)] };
  }

  const outline = outlineOf(shape);
  if (!outline) {
    const pts = dedupe((shape as Extract<Shape, { kind: "poly" }>).points, false);
    if (pts.length < 2) return null;
    return { type: "mill", shape, index, paths: [polylinePath(pts, false)] };
  }

  if (outline.kind === "poly" && outline.pts.length < 3) {
    warn(`${name}: needs at least 3 points to be closed.`);
    return null;
  }

  const one = (p: Path | null, what: string): Cut | null => {
    if (!p) {
      warn(`${name}: ${what}`);
      return null;
    }
    return { type: "mill", shape, index, paths: [p] };
  };

  switch (shape.op) {
    case "on":
      if (outline.kind === "circle") return one(circlePath(outline.c, outline.r, outsideCw), "");
      return one(orientPath(polylinePath(ccwPoints(outline.pts), true), outsideCw), "");

    case "outside":
      if (outline.kind === "circle") return one(circlePath(outline.c, outline.r + tr, outsideCw), "");
      return one(
        (() => {
          const p = offsetPolygon(outline.pts, tr);
          return p && orientPath(p, outsideCw);
        })(),
        "could not compute outside offset (shape may self-intersect).",
      );

    case "inside":
      if (outline.kind === "circle") {
        if (outline.r - tr <= 1e-6) return one(null, "hole is not larger than the tool – skipped.");
        return one(circlePath(outline.c, outline.r - tr, insideCw), "");
      }
      return one(
        (() => {
          const p = offsetPolygon(outline.pts, -tr);
          return p && orientPath(p, insideCw);
        })(),
        "shape is too small (or too narrow) for the tool – skipped.",
      );

    case "pocket": {
      if (outline.kind === "circle") {
        const rOut = outline.r - tr;
        if (rOut < 0) return one(null, "pocket is smaller than the tool – skipped.");
        const radii: number[] = [];
        for (let r = rOut; r > 1e-6 && radii.length < 5000; r -= step) radii.push(r);
        const loops: Path[] = [{ start: outline.c, segs: [] }];
        for (const r of radii.reverse()) loops.push(circlePath(outline.c, r, insideCw));
        return { type: "mill", shape, index, paths: loops };
      }
      const loops = pocketPolygon(outline.pts, tr, step, insideCw, (m) => warn(`${name}: ${m}`));
      if (!loops) return one(null, "pocket is too small (or too narrow) for the tool – skipped.");
      return { type: "mill", shape, index, paths: loops };
    }

    default:
      return null;
  }
}

export class Emitter {
  out: string[] = [];
  x = NaN;
  y = NaN;
  z = NaN;
  f = NaN;
  cutLength = 0;
  minutes = 0;

  constructor(
    private dp: number,
    private rapidRate: number,
  ) {}

  n(v: number): string {
    return parseFloat(v.toFixed(this.dp)).toString();
  }

  comment(text: string) {
    this.out.push(`(${text.replace(/[()]/g, "")})`);
  }

  raw(line: string) {
    this.out.push(line);
  }

  private axes(p: { x?: number; y?: number; z?: number }): string {
    let w = "";
    if (p.x !== undefined && this.n(p.x) !== this.n(this.x)) w += ` X${this.n(p.x)}`;
    if (p.y !== undefined && this.n(p.y) !== this.n(this.y)) w += ` Y${this.n(p.y)}`;
    if (p.z !== undefined && this.n(p.z) !== this.n(this.z)) w += ` Z${this.n(p.z)}`;
    return w;
  }

  private travel(p: { x?: number; y?: number; z?: number }): number {
    const dx = p.x !== undefined && !isNaN(this.x) ? p.x - this.x : 0;
    const dy = p.y !== undefined && !isNaN(this.y) ? p.y - this.y : 0;
    const dz = p.z !== undefined && !isNaN(this.z) ? p.z - this.z : 0;
    return Math.hypot(dx, dy, dz);
  }

  private moveTo(p: { x?: number; y?: number; z?: number }) {
    if (p.x !== undefined) this.x = p.x;
    if (p.y !== undefined) this.y = p.y;
    if (p.z !== undefined) this.z = p.z;
  }

  private feedWord(f: number): string {
    if (this.n(f) === this.n(this.f)) return "";
    this.f = f;
    return ` F${this.n(f)}`;
  }

  rapid(p: { x?: number; y?: number; z?: number }) {
    const w = this.axes(p);
    if (!w) return;
    this.minutes += this.travel(p) / this.rapidRate;
    this.out.push(`G0${w}`);
    this.moveTo(p);
  }

  feed(p: { x?: number; y?: number; z?: number }, f: number) {
    const w = this.axes(p);
    if (!w) return;
    const len = this.travel(p);
    this.cutLength += len;
    this.minutes += len / f;
    this.out.push(`G1${w}${this.feedWord(f)}`);
    this.moveTo(p);
  }

  arc(to: Pt, c: Pt, cw: boolean, f: number) {
    const from = { x: this.x, y: this.y };
    const len = dist(from, c) * arcSweep(from, to, c, cw);
    this.cutLength += len;
    this.minutes += len / f;
    const i = this.n(c.x - from.x);
    const j = this.n(c.y - from.y);
    this.out.push(`${cw ? "G2" : "G3"} X${this.n(to.x)} Y${this.n(to.y)} I${i} J${j}${this.feedWord(f)}`);
    this.moveTo(to);
  }

  seg(seg: Path["segs"][number], f: number) {
    if (seg.type === "line") this.feed({ x: seg.to.x, y: seg.to.y }, f);
    else this.arc(seg.to, seg.c, seg.cw, f);
  }
}

export function depthPasses(depth: number, passDepth: number): number[] {
  const n = Math.max(1, Math.ceil(depth / passDepth - 1e-9));
  return Array.from({ length: n }, (_, i) => -(depth * (i + 1)) / n);
}

export interface MillOptions {
  safeZ: number;
  feedHeight: number;
  passDepth: number;
  feedRate: number;
  plungeRate: number;
  /** When set, the tool lifts to `z` over these pieces on passes deeper than `z`. */
  tabs?: { z: number; pieces: Piece[] };
}

/** Emit a multi-pass milling cut over one or more connected paths, ending retracted at safe Z. */
export function emitMill(e: Emitter, paths: Path[], depth: number, o: MillOptions) {
  const stayDown = paths.length === 1 && isClosed(paths[0]);
  depthPasses(depth, o.passDepth).forEach((z, pass) => {
    if (pass === 0 || !stayDown) {
      e.rapid({ z: o.safeZ });
      e.rapid({ x: paths[0].start.x, y: paths[0].start.y });
      e.rapid({ z: o.feedHeight });
    }
    e.feed({ z }, o.plungeRate);
    if (o.tabs && z < o.tabs.z - 1e-9) {
      for (const piece of o.tabs.pieces) {
        const want = piece.inTab ? o.tabs.z : z;
        if (Math.abs(e.z - want) > 1e-9) e.feed({ z: want }, o.plungeRate);
        e.seg(piece.seg, o.feedRate);
      }
      return;
    }
    paths.forEach((path, i) => {
      if (i > 0) e.feed({ x: path.start.x, y: path.start.y }, o.feedRate);
      for (const seg of path.segs) e.seg(seg, o.feedRate);
    });
  });
  e.rapid({ z: o.safeZ });
}

/** Evenly spaced tab intervals (in path length) for a closed path, or null if they don't fit. */
function tabIntervals(path: Path, count: number, gap: number): [number, number][] | null {
  const total = pathLength(path);
  if (count * gap >= total * 0.8) return null;
  return Array.from({ length: count }, (_, i) => {
    const c = ((i + 0.5) * total) / count;
    return [c - gap / 2, c + gap / 2] as [number, number];
  });
}

export function machineHeader(e: Emitter, units: JobSettings["units"], safeZ: number, rpm: number) {
  e.raw("G90 G17 G94");
  e.raw(units === "in" ? "G20" : "G21");
  e.rapid({ z: safeZ });
  e.raw(`M3 S${Math.round(rpm)}`);
  e.raw("G4 P2");
}

export function machineFooter(e: Emitter, safeZ: number) {
  e.rapid({ z: safeZ });
  e.raw("M5");
  e.rapid({ x: 0, y: 0 });
  e.raw("M30");
}

export const newEmitter = (units: JobSettings["units"]) => new Emitter(units === "in" ? 4 : 3, units === "in" ? 120 : 3000);

export function generateGcode(shapes: Shape[], s: JobSettings): GcodeResult {
  const warnings: string[] = [];
  const inch = s.units === "in";
  const e = newEmitter(s.units);
  const feedHeight = Math.min(s.safeZ, inch ? 0.04 : 1);

  if (s.toolDiameter <= 0) warnings.push("Tool diameter must be greater than zero.");
  if (s.passDepth <= 0) warnings.push("Depth per pass must be greater than zero.");
  if (s.feedRate <= 0 || s.plungeRate <= 0) warnings.push("Feed and plunge rates must be greater than zero.");
  if (s.safeZ <= 0) warnings.push("Safe Z should be above the stock (greater than zero).");
  const settingsOk = s.toolDiameter > 0 && s.passDepth > 0 && s.feedRate > 0 && s.plungeRate > 0;

  const cuts: Cut[] = [];
  if (settingsOk) {
    shapes.forEach((shape, i) => {
      const index = i + 1;
      const name = `#${index} ${KIND_LABELS[shape.kind]}`;
      if (!(shape.depth > 0)) {
        warnings.push(`${name}: depth is zero – skipped.`);
        return;
      }
      if (shape.depth > s.stockT + 1e-9) {
        warnings.push(`${name}: depth ${shape.depth} is deeper than the stock (${s.stockT}) – check your spoilboard.`);
      }
      if (supportsTabs(shape) && !shape.tabs && shape.depth >= s.stockT - 1e-9) {
        warnings.push(`${name}: cuts all the way through with no holding tabs – the part may come loose.`);
      }
      const cut = buildCut(shape, index, s, (m) => warnings.push(m));
      if (cut) cuts.push(cut);
    });
  }
  cuts.sort((a, b) => OP_ORDER[a.shape.op] - OP_ORDER[b.shape.op] || a.index - b.index);

  e.comment(`Generated by CNC Draw on ${new Date().toISOString().slice(0, 10)}`);
  e.comment(`Stock ${s.stockW} x ${s.stockH} x ${s.stockT} ${s.units}. Origin: X0 Y0 lower-left, Z0 top of stock`);
  e.comment(`Tool: ${s.toolDiameter} ${s.units} end mill, ${s.climb ? "climb" : "conventional"} milling`);
  machineHeader(e, s.units, s.safeZ, s.spindleRpm);

  const preview: PreviewCut[] = [];

  for (const cut of cuts) {
    const { shape } = cut;
    const name = `#${cut.index} ${KIND_LABELS[shape.kind]}`;
    e.comment(`${name} - ${shape.op} - depth ${shape.depth}`);

    if (cut.type === "drill") {
      const { at } = cut;
      e.rapid({ z: s.safeZ });
      e.rapid({ x: at.x, y: at.y });
      e.rapid({ z: feedHeight });
      let prev = 0;
      for (const z of depthPasses(shape.depth, s.passDepth)) {
        if (prev < 0) e.rapid({ z: prev + feedHeight });
        e.feed({ z }, s.plungeRate);
        e.rapid({ z: feedHeight });
        prev = z;
      }
      e.rapid({ z: s.safeZ });
      preview.push({ shapeId: shape.id, lines: [], drills: [at], tabs: [] });
      continue;
    }

    const { paths } = cut;
    let tabs: MillOptions["tabs"];
    const tabPreview: Pt[][] = [];
    if (supportsTabs(shape) && shape.tabs && shape.tabs > 0 && paths.length === 1) {
      const tabZ = -(shape.depth - s.tabHeight);
      const intervals = tabIntervals(paths[0], Math.round(shape.tabs), s.tabWidth + s.toolDiameter);
      if (s.tabHeight <= 0 || tabZ >= 0) {
        warnings.push(`${name}: tab height must be between 0 and the cut depth – tabs skipped.`);
      } else if (!intervals) {
        warnings.push(`${name}: too many / too wide tabs for this outline – tabs skipped.`);
      } else {
        const pieces = splitPath(paths[0], intervals);
        tabs = { z: tabZ, pieces };
        for (const p of pieces) {
          if (p.inTab) tabPreview.push(samplePath({ start: p.from, segs: [p.seg] }));
        }
      }
    }

    emitMill(e, paths, shape.depth, {
      safeZ: s.safeZ,
      feedHeight,
      passDepth: s.passDepth,
      feedRate: s.feedRate,
      plungeRate: s.plungeRate,
      tabs,
    });

    const lines: Pt[][] = [];
    let last: Pt | null = null;
    for (const path of paths) {
      if (last) lines.push([last, path.start]);
      const pts = samplePath(path);
      lines.push(pts);
      last = pts[pts.length - 1];
    }
    preview.push({
      shapeId: shape.id,
      lines,
      drills: paths.length === 1 && !paths[0].segs.length ? [paths[0].start] : [],
      tabs: tabPreview,
    });
  }

  machineFooter(e, s.safeZ);

  return {
    gcode: e.out.join("\n") + "\n",
    preview,
    warnings,
    stats: { lines: e.out.length, cutLength: e.cutLength, minutes: e.minutes },
  };
}
