import { emitMill, machineFooter, machineHeader, newEmitter, pocketPolygon } from "./gcode";
import { samplePath } from "./geometry";
import type { Pt, Units } from "./types";

/**
 * Through-dovetail drawer box, cut with both boards clamped vertically
 * (end grain up) against a sacrificial backer at the front of the machine.
 *
 * Tails go on the drawer sides so the front can't pull off; pins go on the
 * front and back. Each board end is cut in the same setup:
 *   X0 = left edge of the board, Y0 = outside face (toward you, free side),
 *   +Y = into the board toward the backer, Z0 = top end of the board.
 */
export interface DovetailParams {
  units: Units;
  /** Outside width of the drawer – length of the front/back (pin boards). */
  drawerWidth: number;
  /** Outside depth of the drawer – length of the sides (tail boards). */
  drawerDepth: number;
  /** Drawer height – the width of every board, i.e. the length of the joint. */
  drawerHeight: number;
  sideThickness: number;
  frontThickness: number;
  /** Dovetail bit: diameter at the tip (its widest point). */
  dtDiameter: number;
  dtAngle: number;
  dtCutLength: number;
  straightDiameter: number;
  /** Full pin width measured at the baseline (inside face of the pin board). */
  pinWidth: number;
  halfPinWidth: number;
  /** Number of tails; 0 = use the recommendation. */
  tails: number;
  /** Target tail width / pin width at the baseline. */
  ratio: number;
  /** Extra clearance added to each side of the pin-board sockets. */
  fit: number;
  dtFeed: number;
  feedRate: number;
  plungeRate: number;
  spindleRpm: number;
  passDepth: number;
  safeZ: number;
}

export const DEFAULT_DOVETAIL: DovetailParams = {
  units: "mm",
  drawerWidth: 400,
  drawerDepth: 450,
  drawerHeight: 150,
  sideThickness: 12.7,
  frontThickness: 12.7,
  dtDiameter: 12.7,
  dtAngle: 14,
  dtCutLength: 22,
  straightDiameter: 6.35,
  pinWidth: 12.7,
  halfPinWidth: 12.7,
  tails: 0,
  ratio: 2.5,
  fit: 0.05,
  dtFeed: 900,
  feedRate: 1200,
  plungeRate: 300,
  spindleRpm: 18000,
  passDepth: 3,
  safeZ: 5,
};

const LENGTH_KEYS = [
  "drawerWidth",
  "drawerDepth",
  "drawerHeight",
  "sideThickness",
  "frontThickness",
  "dtDiameter",
  "dtCutLength",
  "straightDiameter",
  "pinWidth",
  "halfPinWidth",
  "fit",
  "dtFeed",
  "feedRate",
  "plungeRate",
  "passDepth",
  "safeZ",
] as const;

export function convertDovetail(p: DovetailParams, to: Units): DovetailParams {
  if (p.units === to) return p;
  const k = to === "in" ? 1 / 25.4 : 25.4;
  const out: DovetailParams = { ...p, units: to };
  for (const key of LENGTH_KEYS) out[key] = parseFloat((p[key] * k).toFixed(to === "in" ? 6 : 4));
  return out;
}

export interface Layout {
  n: number;
  /** Board width (drawer height). */
  W: number;
  /** Joint depth on the tail board = pin board thickness. */
  L: number;
  /** Lateral shift of an angled wall across the joint depth: L·tan(angle). */
  k: number;
  tail: number;
  tailEnd: number;
  pin: number;
  pinEnd: number;
  halfPin: number;
  halfPinEnd: number;
  /** Tails at the baseline, [left, right] along the board width. */
  tails: [number, number][];
  problems: string[];
}

export function computeLayout(p: DovetailParams, n: number): Layout {
  const W = p.drawerHeight;
  const L = p.frontThickness;
  const k = L * Math.tan((p.dtAngle * Math.PI) / 180);
  const pin = p.pinWidth;
  const hp = p.halfPinWidth;
  const tail = (W - 2 * hp - (n - 1) * pin) / n;
  const minFeature = p.units === "in" ? 0.06 : 1.5;
  const u = p.units;
  const f = (v: number) => `${parseFloat(v.toFixed(u === "in" ? 3 : 2))} ${u}`;

  const tails: [number, number][] = [];
  let x = hp;
  for (let i = 0; i < n; i++) {
    tails.push([x, x + tail]);
    x += tail + pin;
  }

  const problems: string[] = [];
  if (tail <= 0) problems.push("Too many tails for this drawer height.");
  else if (tail + 2 * p.fit <= p.straightDiameter * 1.02)
    problems.push(`Tails are ${f(tail)} at the baseline – too narrow for the ${f(p.straightDiameter)} straight bit to cut the sockets.`);
  if (pin < p.dtDiameter - 1e-9) problems.push(`Pins (${f(pin)}) must be at least as wide as the dovetail bit (${f(p.dtDiameter)}).`);
  if (pin - 2 * k < minFeature)
    problems.push(`Pins would only be ${f(pin - 2 * k)} wide at the outside face – widen the pins or use a shallower bit angle.`);
  if (hp - k < minFeature) problems.push(`Half pins would only be ${f(hp - k)} wide at the outside face – widen them.`);
  if (L > p.dtCutLength) problems.push(`Joint depth ${f(L)} is more than the dovetail bit's cutting length (${f(p.dtCutLength)}).`);
  if (p.dtDiameter - 2 * k <= 0) problems.push("The dovetail bit is too narrow at the top of the joint for this angle and depth.");

  return { n, W, L, k, tail, tailEnd: tail + 2 * k, pin, pinEnd: pin - 2 * k, halfPin: hp, halfPinEnd: hp - k, tails, problems };
}

export interface Recommendation {
  options: (Layout & { score: number })[];
  best: number;
}

/** Try every tail count that fits and pick the valid one closest to the target tail:pin ratio. */
export function recommend(p: DovetailParams): Recommendation {
  const options: Recommendation["options"] = [];
  for (let n = 1; n <= 40; n++) {
    const lay = computeLayout(p, n);
    if (lay.tail <= 0) break;
    options.push({ ...lay, score: Math.abs(lay.tail / lay.pin - p.ratio) });
  }
  const valid = options.filter((o) => !o.problems.length);
  const pool = valid.length ? valid : options;
  const best = pool.reduce<(typeof pool)[number] | null>((a, o) => (!a || o.score < a.score ? o : a), null);
  return { options, best: best?.n ?? 1 };
}

export interface DovetailResult {
  layout: Layout;
  tailGcode: string;
  pinGcode: string;
  /** Dovetail bit pass centers (X) on the tail board. */
  tailPasses: number[];
  /** Straight-bit toolpaths on the pin board end (XY). */
  pinPaths: Pt[][];
  warnings: string[];
}

export function generateDovetail(p: DovetailParams): DovetailResult {
  const rec = recommend(p);
  const n = p.tails > 0 ? Math.round(p.tails) : rec.best;
  const layout = computeLayout(p, n);
  const warnings = [...layout.problems];
  const { W, L, k, tails } = layout;
  const u = p.units;
  const clr = u === "in" ? 0.02 : 0.5;
  const feedHeight = Math.min(p.safeZ, u === "in" ? 0.04 : 1);

  // ---------------- tail boards (drawer sides) – dovetail bit ----------------
  const R = p.dtDiameter / 2;
  const topWidth = p.dtDiameter - 2 * k;
  const step = 0.85 * Math.max(topWidth, 1e-3);
  const ys = -(R + clr);
  const ye = p.sideThickness + clr;

  // Material to remove on the tail board = where the pins go, measured at the baseline.
  const sockets: [number, number][] = [[-Infinity, layout.halfPin]];
  for (let i = 0; i < tails.length - 1; i++) sockets.push([tails[i][1], tails[i + 1][0]]);
  sockets.push([W - layout.halfPin, Infinity]);

  const centersFor = ([a, b]: [number, number]): number[] => {
    // Outermost passes put the bit's wall exactly on the socket wall; edge sockets run until the bit clears the board edge.
    const lo = a === -Infinity ? Math.min(0, b - R) : a + R;
    const hi = b === Infinity ? Math.max(W, a + R) : b - R;
    if (hi <= lo + 1e-9) return [(lo + hi) / 2];
    const count = Math.ceil((hi - lo) / step) + 1;
    return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
  };

  const t = newEmitter(u);
  const tailPasses: number[] = [];
  t.comment("CNC Draw - dovetail drawer - TAIL BOARDS (drawer sides)");
  t.comment(`Run 4 times: both ends of both sides. ${n} tails, joint depth ${L} ${u}`);
  t.comment(`Tool: ${p.dtDiameter} ${u} x ${p.dtAngle} deg dovetail bit`);
  t.comment("Clamp board vertically, end grain up, INSIDE face against a sacrificial backer");
  t.comment("X0 = left edge, Y0 = outside face (toward you), Z0 = top end of board");
  t.comment(`The bit enters from the front and runs ${R + clr} ${u} into the backer`);
  machineHeader(t, u, p.safeZ, p.spindleRpm);
  if (!layout.problems.length) {
    for (const sock of sockets) {
      const cs = centersFor(sock);
      tailPasses.push(...cs);
      t.rapid({ z: p.safeZ });
      t.rapid({ x: cs[0], y: ys });
      t.rapid({ z: feedHeight });
      // Full depth in one go: a dovetail bit can't step down or lift out of the cut.
      t.feed({ z: -L }, p.plungeRate);
      cs.forEach((c, i) => {
        if (i > 0) t.feed({ x: c }, p.dtFeed);
        t.feed({ y: ye }, p.dtFeed);
        t.feed({ y: ys }, p.dtFeed);
      });
      t.rapid({ z: p.safeZ });
    }
  }
  machineFooter(t, p.safeZ);

  // ---------------- pin boards (front & back) – straight bit ----------------
  const r = p.straightDiameter / 2;
  const T = p.frontThickness;
  const sinA = Math.sin((p.dtAngle * Math.PI) / 180);
  // Extend each socket past both faces so the tool fully clears the corners where a flank meets a face.
  const E = r + r * sinA + clr;
  const flank = (x: number, y: number, dir: -1 | 1) => x + dir * (p.fit + (k * (T - y)) / T);

  const pe = newEmitter(u);
  const pinPaths: Pt[][] = [];
  pe.comment("CNC Draw - dovetail drawer - PIN BOARDS (front and back)");
  pe.comment(`Run 4 times: both ends of front and back. ${n} tail sockets, depth ${p.sideThickness} ${u}`);
  pe.comment(`Tool: ${p.straightDiameter} ${u} straight end mill`);
  pe.comment("Clamp board vertically, end grain up, INSIDE face against a sacrificial backer");
  pe.comment("X0 = left edge, Y0 = outside face (toward you), Z0 = top end of board");
  machineHeader(pe, u, p.safeZ, p.spindleRpm);
  if (!layout.problems.length) {
    tails.forEach(([x0, x1], i) => {
      const poly: Pt[] = [
        { x: flank(x0, -E, -1), y: -E },
        { x: flank(x1, -E, 1), y: -E },
        { x: flank(x1, T + E, 1), y: T + E },
        { x: flank(x0, T + E, -1), y: T + E },
      ];
      const loops = pocketPolygon(poly, r, p.straightDiameter * 0.45, false, (m) => warnings.push(`Pin board socket ${i + 1}: ${m}`));
      if (!loops) {
        warnings.push(`Pin board socket ${i + 1} is too narrow for the straight bit.`);
        return;
      }
      pe.comment(`Tail socket ${i + 1}`);
      emitMill(pe, loops, p.sideThickness, {
        safeZ: p.safeZ,
        feedHeight,
        passDepth: p.passDepth,
        feedRate: p.feedRate,
        plungeRate: p.plungeRate,
      });
      let last: Pt | null = null;
      for (const loop of loops) {
        if (last) pinPaths.push([last, loop.start]);
        const pts = samplePath(loop);
        pinPaths.push(pts);
        last = pts[pts.length - 1];
      }
    });
  }
  machineFooter(pe, p.safeZ);

  return {
    layout,
    tailGcode: t.out.join("\n") + "\n",
    pinGcode: pe.out.join("\n") + "\n",
    tailPasses,
    pinPaths,
    warnings,
  };
}
