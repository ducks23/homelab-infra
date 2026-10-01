import type { Pt } from "./types";

export type Seg = { type: "line"; to: Pt } | { type: "arc"; to: Pt; c: Pt; cw: boolean };

/** A tool-center path. Closed paths end where they start. */
export interface Path {
  start: Pt;
  segs: Seg[];
}

const EPS = 1e-9;

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return dist(p, add(a, mul(ab, t)));
}

/** Positive for counter-clockwise polygons (Y up). */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function dedupe(pts: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!out.length || dist(out[out.length - 1], p) > 1e-7) out.push(p);
  }
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-7) out.pop();
  return out;
}

export function polylinePath(pts: Pt[], closed: boolean): Path {
  const tail = closed ? [...pts.slice(1), pts[0]] : pts.slice(1);
  return { start: pts[0], segs: tail.map((to) => ({ type: "line", to })) };
}

/** Full circle as two half arcs, starting at angle 0. */
export function circlePath(c: Pt, r: number, cw: boolean): Path {
  const start = { x: c.x + r, y: c.y };
  const mid = { x: c.x - r, y: c.y };
  return {
    start,
    segs: [
      { type: "arc", to: mid, c, cw },
      { type: "arc", to: start, c, cw },
    ],
  };
}

export function reversePath(path: Path): Path {
  const nodes = [path.start, ...path.segs.map((s) => s.to)];
  const segs: Seg[] = [];
  for (let i = path.segs.length - 1; i >= 0; i--) {
    const s = path.segs[i];
    const to = nodes[i];
    segs.push(s.type === "arc" ? { type: "arc", to, c: s.c, cw: !s.cw } : { type: "line", to });
  }
  return { start: nodes[nodes.length - 1], segs };
}

export function isClosed(path: Path): boolean {
  const end = path.segs.length ? path.segs[path.segs.length - 1].to : path.start;
  return path.segs.length > 0 && dist(end, path.start) < 1e-7;
}

/** Angle swept travelling from `from` to `to` around `c` in the given direction, in (0, 2π]. */
export function arcSweep(from: Pt, to: Pt, c: Pt, cw: boolean): number {
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  let s = cw ? a0 - a1 : a1 - a0;
  while (s <= 1e-9) s += Math.PI * 2;
  while (s > Math.PI * 2 + 1e-9) s -= Math.PI * 2;
  return s;
}

export function samplePath(path: Path): Pt[] {
  const out: Pt[] = [path.start];
  let cur = path.start;
  for (const s of path.segs) {
    if (s.type === "line") {
      out.push(s.to);
    } else {
      const r = dist(cur, s.c);
      const sweep = arcSweep(cur, s.to, s.c, s.cw);
      const a0 = Math.atan2(cur.y - s.c.y, cur.x - s.c.x);
      const n = Math.max(4, Math.ceil(sweep / (Math.PI / 36)));
      for (let i = 1; i <= n; i++) {
        const a = a0 + (s.cw ? -1 : 1) * sweep * (i / n);
        out.push(i === n ? s.to : { x: s.c.x + r * Math.cos(a), y: s.c.y + r * Math.sin(a) });
      }
    }
    cur = s.to;
  }
  return out;
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < -EPS && d3 * d4 < -EPS;
}

/** True if a closed ring of points crosses itself. */
function selfIntersects(ring: Pt[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(a, b, ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Offset a closed polygon by `d` (positive = outward, negative = inward).
 * Corners that "open up" are joined with arcs so the tool stays exactly `|d|`
 * from the geometry; the rest are mitered. Returns a counter-clockwise closed
 * path, or null when the offset collapses or would cross itself.
 */
export function offsetPolygon(input: Pt[], d: number): Path | null {
  let p = dedupe(input, true);
  if (p.length < 3) return null;
  if (signedArea(p) < 0) p = [...p].reverse();
  const n = p.length;

  const edges = p.map((a, i) => {
    const b = p[(i + 1) % n];
    const len = dist(a, b);
    const dir = mul(sub(b, a), 1 / len);
    return { dir, nrm: { x: dir.y, y: -dir.x } };
  });

  type Corner = { in: Pt; out: Pt; arc: boolean; v: Pt };
  const corners: Corner[] = p.map((v, i) => {
    const e0 = edges[(i - 1 + n) % n];
    const e1 = edges[i];
    const q0 = add(v, mul(e0.nrm, d));
    const q1 = add(v, mul(e1.nrm, d));
    const cr = cross(e0.dir, e1.dir);
    if (Math.abs(cr) < 1e-9) {
      if (dot(e0.dir, e1.dir) > 0) return { in: q1, out: q1, arc: false, v };
      return { in: q0, out: q1, arc: true, v };
    }
    if (cr * d > 0) return { in: q0, out: q1, arc: true, v };
    const t = cross(sub(q1, q0), e1.dir) / cr;
    const ip = add(q0, mul(e0.dir, t));
    return { in: ip, out: ip, arc: false, v };
  });

  // An edge whose trimmed offset runs backwards means the offset has collapsed.
  for (let i = 0; i < n; i++) {
    const s = corners[i].out;
    const e = corners[(i + 1) % n].in;
    if (dot(sub(e, s), edges[i].dir) < -1e-9) return null;
  }

  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const next = corners[(i + 1) % n];
    const from = corners[i].out;
    if (dist(from, next.in) > 1e-9) segs.push({ type: "line", to: next.in });
    if (next.arc && dist(next.in, next.out) > 1e-9) {
      segs.push({ type: "arc", to: next.out, c: next.v, cw: d < 0 });
    }
  }
  const path: Path = { start: corners[0].out, segs };

  const ring = samplePath(path).slice(0, -1);
  if (ring.length < 3 || signedArea(ring) <= 0 || selfIntersects(ring)) return null;
  return path;
}

export function segLength(from: Pt, seg: Seg): number {
  return seg.type === "line" ? dist(from, seg.to) : dist(from, seg.c) * arcSweep(from, seg.to, seg.c, seg.cw);
}

export function pathLength(path: Path): number {
  let cur = path.start;
  let len = 0;
  for (const s of path.segs) {
    len += segLength(cur, s);
    cur = s.to;
  }
  return len;
}

function pointOnSeg(from: Pt, seg: Seg, t: number): Pt {
  if (seg.type === "line") return add(from, mul(sub(seg.to, from), t));
  const r = dist(from, seg.c);
  const a0 = Math.atan2(from.y - seg.c.y, from.x - seg.c.x);
  const a = a0 + (seg.cw ? -1 : 1) * arcSweep(from, seg.to, seg.c, seg.cw) * t;
  return { x: seg.c.x + r * Math.cos(a), y: seg.c.y + r * Math.sin(a) };
}

export interface Piece {
  from: Pt;
  seg: Seg;
  inTab: boolean;
}

/** Split a path at the given arc-length intervals, flagging the pieces that fall inside one. */
export function splitPath(path: Path, intervals: [number, number][]): Piece[] {
  const bounds = intervals.flat().sort((a, b) => a - b);
  const out: Piece[] = [];
  let cur = path.start;
  let acc = 0;
  for (const seg of path.segs) {
    const len = segLength(cur, seg);
    const ts = bounds.filter((b) => b > acc + 1e-9 && b < acc + len - 1e-9).map((b) => (b - acc) / len);
    let t0 = 0;
    let from = cur;
    for (const t of [...ts, 1]) {
      const to = t === 1 ? seg.to : pointOnSeg(cur, seg, t);
      const mid = acc + (len * (t0 + t)) / 2;
      out.push({
        from,
        seg: seg.type === "line" ? { type: "line", to } : { ...seg, to },
        inTab: intervals.some(([a, b]) => mid > a && mid < b),
      });
      from = to;
      t0 = t;
    }
    acc += len;
    cur = seg.to;
  }
  return out;
}
