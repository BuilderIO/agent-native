Compose the public `DesignFilePanel`, `DesignSelectionProperties` and `SplitPane` around a canvas when navigation, direct selection and property editing must agree on a single document. This Storybook composition shows how to connect the pieces with a 10,000-layer fixture.

Keep stable layer IDs in the host. A click on a canvas object and a selection change in the tree should update the same selected IDs. Derive inspector values from that selection. For a mixed edit, capture the starting geometries once and keep them until the gesture commits or cancels. Use the same preview geometry for the inspector fields and the selected canvas objects. A layer ID can index that geometry throughout a drag. Commit the edit as one undo entry.

Give both splitters descriptive names, such as “Layers panel width” and “Properties panel width”. A keyboard user can focus a separator and resize its pane with the arrow keys. The mixed, locked and page-history examples exercise interactions that cross panel boundaries.

```tsx
import { SplitPane } from "@agent-native/toolkit/ui/base-ui/split-pane";

<SplitPane side="start" label="Layers panel width" pane={filePanel}>
  <SplitPane side="end" label="Properties panel width" pane={inspector}>
    {canvas}
  </SplitPane>
</SplitPane>;
```

See [Split Pane](?path=/docs/layout-split-pane--docs) for resizing the panels with keyboard or pointer.

## Measuring interaction performance

From the repository root, run the production fixture with Chromium and WebKit installed.

```sh
node packages/toolkit/scripts/workspace-benchmark.ts
```

Each drag lasts 12 seconds. During a scrub, the benchmark compares the inspector value with the canvas preview on every animation frame after editing begins. It also reports frame intervals, trusted pointer events, and pointer delivery times. Add `--all-selected` to scrub all 10,000 layers and verify the exported geometry after commit and undo. Use `--docked-selection` to run the same document-wide check after dragging Inspector to the start edge of the fixed canvas. On a 120 Hz display, use `--headed --target-hz=120`. Each run prints a unique directory under `.tmp/workspace-benchmark/` with the results, idle intervals, and raw drag samples.

Use `--divider-only` to isolate panel resizing. Use `--docked-divider` to move Inspector to the start edge of Canvas and resize the resulting split with the virtualized layer tree mounted. The canvas baseline repeats the drag with tool content hidden and the same canvas, tab strips, and splits visible. The standalone baseline mounts only `SplitPane` at the measured position and size of the docked split. Compare all three to investigate a missed frame. Use `--scrub-only` to compare property scrubbing with the standalone control.

The runner exits with `0` when all workloads pass, `1` for a failed workload or execution error, and `2` when browser or pointer cadence prevents verification. Each workload records its own status and measurements.

To inspect renderer CPU time between frames, run `pnpm exec tsx packages/toolkit/scripts/workspace-trace-cpu.ts <trace.json.gz>` from the repository root. The report includes the 95th and 99th percentiles and counts intervals above the 8.33 ms and 16.67 ms CPU budgets during the longest pointer gesture. The longest consecutive run above 8.33 ms distinguishes isolated spikes from sustained pressure. The report also measures renderer CPU time from pointer press to the first frame and from the last frame through pointer release. These thread timings include input handling, rendering, and benchmark sampling. Use the headed frame-cadence benchmark on a 120 Hz display to verify presentation.

## Checking the grid

Enable **Panel spacing** in the Storybook toolbar. The overlay draws an 8 px grid from each panel’s origin. Blue lines show layer columns and inspector control edges. Resize a panel or move a tool while the overlay is on to see its current measurements. [Inspect the docked grid](?path=/story/patterns-editor-workspace--dockable&globals=spacing:on)

## Docking panels

In the [dockable workspace](?path=/story/patterns-editor-workspace--dockable), Canvas is the permanent work surface. Pick up Layers, Library, Agent or Inspector by its tab. Follow the insertion line along a tab strip to reorder tabs or join another group. To create a split, move into a panel or the canvas and release at a highlighted edge. Releasing in the unmarked center preserves the layout. Drag a divider to resize in 8 px increments. The **Arrange** menu offers the same placements by keyboard or tap, plus **Reset layout**. This story saves separate desktop and compact layouts in this browser. At 800 px and below, tools initially share a strip below the canvas. Resizing back restores the desktop arrangement.

`DockWorkspace` accepts panel IDs, labels and React content independently of the layout. A group holds ordered tab IDs and its active ID. A split holds two children, an axis and a committed pane size. Use `snapToStep` to align new splits and pointer resizing to the keyboard increment. Set `step` to customize it. Feed changes from `onLayoutChange` back through `layout`. Use `isDockLayout` when loading a saved layout against the current panel IDs. Panel content mounts on first visit and retains local state across moves. Docking a tool preserves the canvas viewport and the scroll position of lists inside moved panels, within the new pane’s scroll limits.

Set `--tabs-frame-surface` and `--tabs-frame-rail` on the workspace to theme the joined tab and panel. Use `--dock-preview-line` and `--dock-preview-fill` for drop targets. In forced colors, an outline uses the system highlight color.
