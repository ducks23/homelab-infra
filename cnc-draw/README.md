# CNC Draw

Draw 2D shapes in the browser and export G-code for a 3-axis CNC router/mill (GRBL-style dialect).

```bash
npm install
npm run dev   # http://localhost:3000
```

## Using it

- **Tools** (left rail): Select `V`, Line `L`, Polyline `P`, Rectangle `R`, Circle `C`, Drill `D`, Pan `H`, Fit `F`.
- Scroll to zoom, Space/middle-drag to pan, hold Alt to disable grid snap, arrows nudge, `⌘D` duplicate, `⌘Z`/`⇧⌘Z` undo/redo.
- Select a shape to set its **operation** and **depth**, or type exact dimensions (fields accept math like `10+3/8`).
- The project autosaves to localStorage; *Save project* / *Open…* use a JSON file.

## Operations

| Operation | Shapes | Toolpath |
|-----------|--------|----------|
| On line   | all    | Tool center follows the line (engraving) |
| Outside   | closed | Offset out by tool radius – cuts a part free |
| Inside    | closed | Offset in by tool radius – cuts a hole |
| Pocket    | closed | Concentric offsets clear the whole area, stepover % of tool |
| Drill     | point  | Peck drill using depth-per-pass as the peck |

**Holding tabs:** set a tab count on any *Outside* or *Inside* profile. Tab width and height are in Job setup.
On passes deeper than the tab height, the tool lifts over each tab (shown in cyan). The app warns about through-cuts that have no tabs.

Cuts are ordered drill → pocket → inside → on-line → outside, so parts are cut free last.
Each cut steps down in equal passes no deeper than *Depth per pass*.

## Dovetail drawer builder

Switch to **Dovetail drawer** in the header. Enter the drawer's outside size, board thicknesses, the dovetail bit
(tip diameter, angle, cutting length), and a straight bit. The builder then:

- lists every tail count that fits, and recommends the one closest to your target tail:pin ratio where
  every pin, half pin, and socket can still be cut with your bits (click a row to override)
- draws the tail board face and pin board end with their toolpaths, plus a cut list
- outputs two programs: **tails** (drawer sides, dovetail bit) and **pins** (front/back, straight bit)

Both programs use **vertical workholding**: the board is clamped end grain up at the front of the machine, with its inside
face against a sacrificial backer. X0 is the left edge, Y0 the outside face (toward you), and Z0 the top end.
The dovetail bit plunges to full depth in front of the board, sweeps through into the backer, and backs out the same way
(a dovetail bit can't lift straight out of its cut). The layout is symmetric, so each board is flipped end-for-end
and both ends run the same program. *Fit clearance* widens only the pin-board sockets. Tune it on a test joint.

## Machine conventions

- X0 Y0 = lower-left corner of the stock, Z0 = top of the stock.
- Output: `G90 G17 G94`, `G21`/`G20`, `M3 S…`, `G0/G1/G2/G3` (arcs use I/J), `M5`, `M30`.
- Climb milling assumes a clockwise spindle.

## Limitations

- No tool changes or ramp entry: pockets plunge straight down, so use a center-cutting end mill.
- A concave pocket that splits into separate lobes is only partly cleared (the app shows a warning).

Always check the output in a simulator (e.g. [NC Viewer](https://ncviewer.com)) before you run it on a machine.

## Code

- `src/lib/geometry.ts` – polygon offsetting, arcs, and path helpers
- `src/lib/gcode.ts` – builds toolpaths and emits G-code
- `src/lib/dovetail.ts` – dovetail layout, recommendations, and tail/pin programs
- `src/lib/shapes.ts` – shape hit-testing, editing, and unit conversion
- `src/components/CncEditor.tsx` – the SVG editor UI
- `src/components/DovetailBuilder.tsx` – the dovetail drawer UI
