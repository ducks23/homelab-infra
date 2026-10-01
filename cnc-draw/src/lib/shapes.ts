import { dist, distToSeg, pointInPolygon } from "./geometry";
import type { JobSettings, Operation, Pt, Shape } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);

export function isClosedShape(s: Shape): boolean {
  return s.kind === "rect" || s.kind === "circle" || (s.kind === "poly" && s.closed);
}

export const supportsTabs = (s: Shape) => isClosedShape(s) && (s.op === "outside" || s.op === "inside");

export function allowedOps(s: Shape): Operation[] {
  if (s.kind === "drill") return ["drill"];
  if (isClosedShape(s)) return ["outside", "inside", "pocket", "on"];
  return ["on"];
}

export const OP_LABELS: Record<Operation, string> = {
  on: "On line (engrave)",
  outside: "Outside (cut out)",
  inside: "Inside (hole)",
  pocket: "Pocket (clear)",
  drill: "Drill",
};

export const KIND_LABELS: Record<Shape["kind"], string> = {
  line: "Line",
  poly: "Polyline",
  rect: "Rectangle",
  circle: "Circle",
  drill: "Drill point",
};

export function rectPoints(s: { x: number; y: number; w: number; h: number }): Pt[] {
  return [
    { x: s.x, y: s.y },
    { x: s.x + s.w, y: s.y },
    { x: s.x + s.w, y: s.y + s.h },
    { x: s.x, y: s.y + s.h },
  ];
}

/** Distance from p to the shape's outline, treating the interior of closed shapes as a hit. */
export function hitDistance(s: Shape, p: Pt): number {
  switch (s.kind) {
    case "line":
      return distToSeg(p, s.a, s.b);
    case "poly": {
      let d = Infinity;
      const n = s.points.length;
      const segs = s.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) d = Math.min(d, distToSeg(p, s.points[i], s.points[(i + 1) % n]));
      if (s.closed && pointInPolygon(p, s.points)) d = Math.min(d, 0);
      return d;
    }
    case "rect": {
      const pts = rectPoints(s);
      let d = Infinity;
      for (let i = 0; i < 4; i++) d = Math.min(d, distToSeg(p, pts[i], pts[(i + 1) % 4]));
      if (pointInPolygon(p, pts)) d = 0;
      return d;
    }
    case "circle": {
      const dc = dist(p, { x: s.cx, y: s.cy });
      return dc <= s.r ? 0 : dc - s.r;
    }
    case "drill":
      return dist(p, { x: s.x, y: s.y });
  }
}

/** Topmost shape near p. Outline hits win over interior hits so nested shapes stay selectable. */
export function hitTest(shapes: Shape[], p: Pt, tol: number): Shape | null {
  let interior: Shape | null = null;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const d = hitDistance(s, p);
    const onOutline =
      s.kind === "circle"
        ? Math.abs(dist(p, { x: s.cx, y: s.cy }) - s.r) <= tol
        : s.kind === "rect" || (s.kind === "poly" && s.closed)
          ? outlineDistance(s, p) <= tol
          : d <= tol;
    if (onOutline) return s;
    if (d === 0 && !interior) interior = s;
  }
  return interior;
}

function outlineDistance(s: Shape, p: Pt): number {
  const pts = s.kind === "rect" ? rectPoints(s) : s.kind === "poly" ? s.points : [];
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) d = Math.min(d, distToSeg(p, pts[i], pts[(i + 1) % pts.length]));
  return d;
}

export function getHandles(s: Shape): Pt[] {
  switch (s.kind) {
    case "line":
      return [s.a, s.b];
    case "poly":
      return s.points;
    case "rect":
      return rectPoints(s);
    case "circle":
      return [{ x: s.cx + s.r, y: s.cy }];
    case "drill":
      return [];
  }
}

export function applyHandle(s: Shape, index: number, p: Pt): Shape {
  switch (s.kind) {
    case "line":
      return index === 0 ? { ...s, a: p } : { ...s, b: p };
    case "poly":
      return { ...s, points: s.points.map((q, i) => (i === index ? p : q)) };
    case "rect": {
      const opp = rectPoints(s)[(index + 2) % 4];
      return {
        ...s,
        x: Math.min(opp.x, p.x),
        y: Math.min(opp.y, p.y),
        w: Math.abs(p.x - opp.x),
        h: Math.abs(p.y - opp.y),
      };
    }
    case "circle":
      return { ...s, r: Math.max(dist(p, { x: s.cx, y: s.cy }), 1e-3) };
    case "drill":
      return s;
  }
}

export function translate(s: Shape, dx: number, dy: number): Shape {
  const t = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  switch (s.kind) {
    case "line":
      return { ...s, a: t(s.a), b: t(s.b) };
    case "poly":
      return { ...s, points: s.points.map(t) };
    case "rect":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "circle":
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case "drill":
      return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

export function scaleShape(s: Shape, k: number): Shape {
  const sc = (p: Pt) => ({ x: p.x * k, y: p.y * k });
  const depth = s.depth * k;
  switch (s.kind) {
    case "line":
      return { ...s, depth, a: sc(s.a), b: sc(s.b) };
    case "poly":
      return { ...s, depth, points: s.points.map(sc) };
    case "rect":
      return { ...s, depth, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k };
    case "circle":
      return { ...s, depth, cx: s.cx * k, cy: s.cy * k, r: s.r * k };
    case "drill":
      return { ...s, depth, x: s.x * k, y: s.y * k };
  }
}

/** Convert a job and its shapes between mm and inches. */
export function convertUnits(
  shapes: Shape[],
  settings: JobSettings,
  to: JobSettings["units"],
): { shapes: Shape[]; settings: JobSettings } {
  if (settings.units === to) return { shapes, settings };
  const k = to === "in" ? 1 / 25.4 : 25.4;
  const r = (v: number) => parseFloat((v * k).toFixed(to === "in" ? 6 : 4));
  return {
    shapes: shapes.map((s) => scaleShape(s, k)),
    settings: {
      ...settings,
      units: to,
      stockW: r(settings.stockW),
      stockH: r(settings.stockH),
      stockT: r(settings.stockT),
      toolDiameter: r(settings.toolDiameter),
      feedRate: r(settings.feedRate),
      plungeRate: r(settings.plungeRate),
      safeZ: r(settings.safeZ),
      passDepth: r(settings.passDepth),
      defaultDepth: r(settings.defaultDepth),
      gridSize: to === "in" ? 0.125 : 5,
      tabWidth: r(settings.tabWidth),
      tabHeight: r(settings.tabHeight),
    },
  };
}
