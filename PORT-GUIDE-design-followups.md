# Port guide — design follow-up features → changes-423 (post design→core refactor)

**Reference:** `origin/updates-design-followups` @ `73571c7db1` (off main, all green: 1296 design tests, tsc, guards, oxfmt, prod build).
**Precise spec = the diff:** `git diff main...updates-design-followups -- <path>` per file below. This guide maps each change to where it likely now lives after the design→core refactor. Apply onto the REFACTORED files (in core if they moved there), NOT the old templates/design paths.

**22 files, +3970/-191.** Split into FOUNDATIONS (self-contained, low-risk — copy the added exports to wherever the module now lives) and INTEGRATION (re-apply into the refactored DesignEditor/EditPanel — the fiddly part).

---

## FOUNDATIONS (port first — pure, additive, few conflicts)

### F1. pen-path.ts (+296) / pen-path.test.ts (+534) [feature: vector edit]

Wherever pen-path now lives (core?), add exported: `serializePenNodes(path)`, `parsePenNodes(s)` (format = JSON `[closedFlag, ...[px,py,hix,hiy,hox,hoy]]`, missing handle = null pair), `hitTestPenAnchor`, `hitTestPenHandle`, `movePenAnchor`, `movePenHandle`, `setPenNodeType`. All pure/immutable. Copy the tests too.

### F2. inspector/ScrubInput.tsx (+81) + scrub-input-utils.ts (+56) + index.ts (+9) [feature: PF12]

Add `phase: "preview"|"commit"` (required) to `ScrubInputChangeMeta`. Scrub pointermove ticks = "preview"; pointerup-ends-drag + Enter/blur/arrow = "commit" (exactly one commit per gesture — a NEW commit-phase emit on pointerup is the key addition). Extracted pure `startScrubDrag`/`updateScrubDrag` state machine in scrub-input-utils (copy + tests).

### F3. inspector/DesignColorPicker.tsx (+137) [feature: PF12]

Add optional prop `onChangeComplete?: (value: string) => void` — fires ONCE per gesture (SV/hue/alpha drag end, keyboard step, hex commit, eyedropper, swatch, paint-type). onChange stays per-tick. Internal `lastEmittedValueRef` + `startPointerGesture`/`endPointerGesture` primitive.

### F4. LayersPanel.tsx (+178) [feature: L12]

Recompose as `memo(forwardRef(...))`; export `interface LayersPanelHandle { beginRename(layerId): boolean }` + `findNodeWithAncestors` helper. `beginRename`: expand ancestors, scroll into view, focus+select the rename input. Requires the panel's existing `onRename` prop. GOTCHA: if the refactor changed LayersPanel's memo/ref shape, compose forwardRef+memo correctly and preserve displayName + existing refs.

### F5. CanvasContextMenu.tsx (+12) [feature: L12]

Already target-agnostic — only doc-comment clarifications added. Rename item shows when `canRename` true + `onRename` supplied + "rename" not in hiddenActions. No behavior change needed in the component; the gating lives at the DesignEditor call site (see I4).

### F6. DesignCanvas.tsx (+379) + DesignCanvas.creation-overlay.test.ts (+59) [feature: single-screen placement]

Add props `activeCreationTool?: CreationTool|null` + `onCreatePrimitive?: (spec)=>void` (spec = {tool, rect?, points?, fromClick}, SCREEN-CONTENT coords). New `SingleScreenCreationOverlay` (mounts only when tool active) + pure `getScreenContentPointFromClient` helper. Backward compatible. GOTCHA: if DesignCanvas moved to core/shared for slides, this creation overlay likely belongs there too (slides benefits).

### F7. MultiScreenCanvas.tsx (+560) + primitives.test.ts (+144) [feature: vector edit overlay]

Add prop `vectorEdit?: VectorEditOverlayState|null` (= {path (local coords), originCanvas (Point), onChange(next, phase), onExit}). New interactive `VectorEditOverlay` (draggable anchors/handles, chromeScale-sized), + pure `vectorEditLocalToCanvasPoint`/`vectorEditCanvasToLocalPoint`/`screenPxToCanvasPx`. Interaction centralized in the top-level `handleMouseDown` dispatcher (special-cases vectorEdit first) + two DragState members `vector-anchor`/`vector-handle`. Reuses installDragListeners/getCanvasPoint. Escape/empty-click already call onExit.

---

## INTEGRATION (re-apply into the refactored DesignEditor.tsx / EditPanel.tsx — highest care)

### I1. Single-screen tool placement [DesignEditor +, ~part of the +787]

- `handleTextTool`/`handleShapeTool`/`handlePenTool`: when `viewModeRef.current==="single" && activeFile`, arm the tool WITHOUT `setViewMode("overview")`. Overview path unchanged.
- New pure helpers `getSingleScreenCreationTool({activeTool,viewMode,hasActiveFile})` and `createPrimitiveInsertFromSpec(spec, nodeId)`.
- New `handleSingleScreenCreatePrimitive` → routes through the SAME `handleCreatePrimitive`+`handlePrimitiveCreated` overview uses. Wire `<DesignCanvas activeCreationTool={...} onCreatePrimitive={...}/>` on the single-screen instance.
- Pen fromClick in single-screen commits a minimal 2-node path (multi-click pen deferred).

### I2. Vector edit mode [DesignEditor +]

- Coordinate finding: committed pen node coords are SCREEN-CONTENT absolute (same space as boundingRect). originCanvas = the screen frame's canvas {x,y} (board file = {0,0}).
- Persist on commit: in `handleCreatePrimitive`, reconstruct PenPath from `primitive.pathData` via new `parsePenPathFromSerializedD(d)` (grammar-exact inverse of serializePenPath — copy it + tests) and stamp `data-an-pen-nodes` via `setPenNodesAttributeOnElement`. NOTE: preserveAspectRatio="none" + closed-path fill were added by the prior merged sweep — verify they're present in the refactored commit path.
- Enter (overview only): `handleEnterHotkey` checks single selected layer for `data-an-pen-nodes` → `enterVectorEditForSelection` (parse nodes, resolve originCanvas via `getScreenFrameOriginCanvas`, set `vectorEditingState`).
- Wire `<MultiScreenCanvas vectorEdit={vectorEditOverlayState}/>`; onChange updates working path (preview) / re-serializes + `writeBackVectorEditedPenPath` via applyFileContentUpdate (commit); onExit clears state. `enterSingleScreen` clears vectorEditingState.
- DEFERRED: single-screen vector entry (overlay only in overview) + double-click entry (bridge posts no dblclick for pen SVG).

### I3. PF12 throttled commits [DesignEditor + EditPanel]

- EditPanel: change `onStyleChange`/`onStylesChange` to `StyleChangeHandler`/`StylesChangeHandler` carrying `StyleChangeMeta {phase?}`. Thread phase through EVERY ScrubInput-backed control (AppearanceScrubField, ScrubStyleInput, stroke-weight, blur filters, typography, ShadowEffectRow). Wire DesignColorPicker `onChangeComplete` at the 4 solid-color call sites (page bg, fill, stroke, shadow, selection swatch): onChange={phase:"preview"}, onChangeComplete={phase:"commit"}. Gradient/image/layered path left committing per tick (documented scope cut).
- DesignEditor: new pure `shouldSkipVisualStyleCommitForPreview({phase, selectedLayerCount})` (true only phase==="preview" && single selection). `handleStyleChange`/`handleStylesChange` check it FIRST: preview → cheap `window.__designCanvasSendStyle` postMessage preview + return (NO source write); commit/undefined → full existing commitVisualStyles path.
- UNDO-SAFETY (must preserve): preview ticks make ZERO source writes → exactly one history entry per gesture, always the final value. Verify this composes with the refactored undo/history recording.

### I4. L12 inline rename [DesignEditor + i18n]

- `layersPanelRef = useRef<LayersPanelHandle>(null)` → `ref` on `<LayersPanel>`.
- Cmd+R (useDesignHotkeys.onRename): if exactly one renamable layer selected → `layersPanelRef.current?.beginRename(id)`; else design-title rename. New helper `getSingleSelectedRenamableLayerId()`.
- CanvasContextMenu: `canRename` from that helper, remove `hiddenActions={["rename"]}`, `onRename`→beginRename.
- REMOVE the interim `toast.info(...layerRenameSelectLayer)` call AND remove the `layerRenameSelectLayer` key from i18n-data.ts (English + 9 override locales) and i18n/zh-TW.ts. Run `pnpm guards` (guard:i18n-catalogs) after — must pass with key fully gone.

---

## Apply order: F1-F7 first (foundations, mostly copy), then I1-I4 (re-wire into refactored DesignEditor/EditPanel). Verify: pnpm exec tsc --noEmit; pnpm vitest --run (design + slides if editor now shared); pnpm guards; oxfmt.

## If DesignEditor/MultiScreenCanvas/DesignCanvas moved to core shared-by-slides: the overlays (vector edit, single-screen creation) and pen-path foundations SHOULD go to the shared location so slides gets them; the DesignEditor-page integration (I1-I4) stays app-side wherever the page lives.
