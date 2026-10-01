export type Pt = { x: number; y: number };

/**
 * on       – tool center follows the line (engraving / open paths)
 * outside  – tool offset outside the closed shape (cut a part out)
 * inside   – tool offset inside the closed shape (cut a hole)
 * pocket   – clear all material inside the closed shape
 * drill    – plunge straight down (peck drilling)
 */
export type Operation = "on" | "outside" | "inside" | "pocket" | "drill";

interface ShapeBase {
  id: string;
  op: Operation;
  /** Positive cut depth below the top of the stock (Z0). */
  depth: number;
  /** Number of holding tabs on outside/inside profiles (0 or missing = none). */
  tabs?: number;
}

export type LineShape = ShapeBase & { kind: "line"; a: Pt; b: Pt };
export type PolyShape = ShapeBase & { kind: "poly"; points: Pt[]; closed: boolean };
export type RectShape = ShapeBase & { kind: "rect"; x: number; y: number; w: number; h: number };
export type CircleShape = ShapeBase & { kind: "circle"; cx: number; cy: number; r: number };
export type DrillShape = ShapeBase & { kind: "drill"; x: number; y: number };

export type Shape = LineShape | PolyShape | RectShape | CircleShape | DrillShape;
export type ShapeKind = Shape["kind"];

export type Units = "mm" | "in";

export interface JobSettings {
  units: Units;
  stockW: number;
  stockH: number;
  stockT: number;
  toolDiameter: number;
  feedRate: number;
  plungeRate: number;
  spindleRpm: number;
  safeZ: number;
  passDepth: number;
  /** Pocket stepover as a percentage of tool diameter. */
  stepover: number;
  climb: boolean;
  defaultDepth: number;
  gridSize: number;
  /** Tab length along the part edge. */
  tabWidth: number;
  /** Material left under each tab (measured up from the bottom of the cut). */
  tabHeight: number;
}

export const DEFAULT_SETTINGS: JobSettings = {
  units: "mm",
  stockW: 200,
  stockH: 150,
  stockT: 12,
  toolDiameter: 3.175,
  feedRate: 800,
  plungeRate: 200,
  spindleRpm: 12000,
  safeZ: 5,
  passDepth: 1,
  stepover: 40,
  climb: true,
  defaultDepth: 3,
  gridSize: 5,
  tabWidth: 6,
  tabHeight: 1.5,
};

export interface Project {
  version: 1;
  shapes: Shape[];
  settings: JobSettings;
  dovetail?: import("./dovetail").DovetailParams;
}
