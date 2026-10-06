# Measuring Design performance

## Run a production build locally

Dev builds are dominated by React's `jsxDEV` and Vite's module graph, so
profile only a production build. From `templates/design`:

```sh
pnpm build
DATABASE_URL=postgres://postgres@127.0.0.1:5432/design_perf pnpm migrate:production
DATABASE_URL=postgres://postgres@127.0.0.1:5432/design_perf AUTH_DISABLED=1 \
  AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS=1 \
  BETTER_AUTH_SECRET=<any-local-value> PORT=9444 APP_URL=http://127.0.0.1:9444 pnpm start
pnpm perf:runtime-budget --base-url http://127.0.0.1:9444
```

`--design <id>` reuses an existing board instead of seeding one, and `--headed`
shows the browser. `e2e/fixtures/seed-perf-stress-design.ts` creates the board
by itself when you want to drive it by hand.

## Traps that faked results

- **A gesture that never happened measures nothing.** Assert that the screen
  moved, the text changed, or the card count went up before reading a timing.
  A drag probe that sets `style.left` from script never reproduces drag jank;
  only a real pointer drag does.
- **`page.mouse.click` has no `modifiers` option.** It does not complain about
  one either. Hold the key with `keyboard.down("ControlOrMeta")` around the
  click; plain `Meta` is the Super key on Linux runners.
- **Zoom-to-fit (`Shift+2`) on a large board lands near 4%.** Zoom with
  Ctrl+wheel through `Input.dispatchMouseEvent`, sent without awaiting each
  event: awaited events let the camera settle between them. The canvas
  ignores untrusted `WheelEvent`s.
- **The DevTools Memory panel shows the heap before GC.** Call
  `HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage`. The page's heap
  includes the same-origin live editors; static previews run in their own
  process, so measure them through a CDP session on one of their frames.
- **A refresh is not a remount.** Swapping a screen between its preview and its
  editor blanks it without remounting anything. Count a refresh as a visible
  screen going from "has a loaded iframe" to "doesn't", sampled every 50 ms;
  the runtime budget does exactly that.
- **On battery, Chrome caps frames at 30 Hz.** Headless Chromium rasterizes on
  the CPU. A cold Vite server reloads the page on its first open.
- **Design Vitest prints `console.log` only for failing tests.** Force a
  failure to see debug output.
- **Mutation-checking a memo means reverting its dependency array too.** A
  condition swapped without its deps leaves the memo stale, so the "old
  behavior" under test never shipped.

## Finding what holds memory

1. **Micro-soak.** Repeat the one suspect action N times, reading the heap
   after GC each time. The slope after the first repetition is the leak per
   action.
2. **Sampling heap profiler.** `HeapProfiler.startSampling` across the window,
   force a GC, then `stopSampling`. It returns allocation sites of objects
   still alive. It's cheap, but it gives no retainers.
3. **Shape diff of two snapshots.** Snapshot after N and after 2N repetitions
   (keep each near 600 MB; over 1 GB they hang), then count objects by
   property shape and diff the counts. The shape that grows names the
   structure; its retainer path names the code. This is what found the
   closure-chain leak in `DesignEditor.tsx`.

   memlab reads the snapshots. It is not a repo dependency; install it
   outside the repo. A ~600 MB snapshot needs a ~10 GB Node heap, and memlab's
   own launcher caps Node at 4 GB, so run its scripts through `node` directly.

   ```sh
   npm install --prefix /tmp/memlab-tool memlab
   node --max-old-space-size=10000 shape-counts.cjs before.heapsnapshot before.json
   ```

   ```js
   // /tmp/memlab-tool/shape-counts.cjs
   const { getFullHeapFromFile } = require("@memlab/heap-analysis");
   (async () => {
     const heap = await getFullHeapFromFile(process.argv[2]);
     const shapes = {};
     heap.nodes.forEach((node) => {
       if (node.type !== "object") return;
       const key =
         node.name === "Object"
           ? node.references
               .filter((edge) => edge.type === "property")
               .map((edge) => String(edge.name_or_index))
               .slice(0, 8)
               .sort()
               .join(",")
           : node.name;
       shapes[key] = (shapes[key] ?? 0) + 1;
     });
     require("fs").writeFileSync(process.argv[3], JSON.stringify(shapes));
   })();
   ```

4. **Retainer paths.** `memlab find-leaks --baseline s1 --target s2 --final
s3 --trace-all-objects` lists objects allocated between the first two
   snapshots that are still alive in the third, grouped by the path that keeps
   them. Without `--trace-all-objects` it reports only detached DOM and
   unmounted React nodes, which a closure-held leak is not. The traced paths
   ran through closure contexts (`context → previous → … → tree`), which is
   how the `DesignEditor.tsx` leak was found; the shape diff then measured it.

## Attributing a long frame

- `long-animation-frame` entries split a frame into script, style and layout,
  and give script source positions.
- A `devtools.timeline` trace shows PrePaint, Layerize and RasterTask. A
  PrePaint inside a pointer hit test was the screen-drag stall.
- To map minified frames to source, build with `build: { sourcemap: true }` in
  `vite.config.ts` (locally only) and resolve `file:line:col` through the map.
