import { useT } from "@agent-native/core/client";
import {
  IconEraser,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconLoader2,
  IconSend,
  IconCursorText,
  IconX,
} from "@tabler/icons-react";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface DrawAnnotation {
  id: string;
  type: "path" | "text";
  /** SVG path data for "path" type */
  pathData?: string;
  /** Text content for "text" type */
  text?: string;
  /** Annotation color (hex) */
  color: string;
  /** Stroke width for paths, font weight reference for text */
  lineWidth: number;
  /** Position relative to the canvas (text annotations only) */
  position: { x: number; y: number };
  /**
   * Creation timestamp (Date.now()) — used for unified undo ordering across
   * strokes and text annotations. Optional so existing callers of DrawAnnotation
   * don't need to supply it.
   */
  createdAt?: number;
}

interface DrawOverlayProps {
  /** Whether the overlay is currently visible (toggled from the toolbar) */
  visible: boolean;
  /** When false, canvas clicks pass through to sibling tools while the toolbar stays usable. */
  canvasInteractive?: boolean;
  /** Extra queued annotations owned by sibling tools, such as comment pins. */
  queuedAnnotationCount?: number;
  /**
   * Current zoom level (percentage, e.g. 100 = 100%). Used to convert
   * getBoundingClientRect() visual-space coordinates to layout-space so that
   * strokes and text labels stay anchored to their painted position across
   * zoom changes.
   */
  zoom?: number;
  /** Called when the user submits the queued strokes/text to the agent */
  onSend: (
    annotations: DrawAnnotation[],
    instruction: string,
    canvasSize: { width: number; height: number },
  ) => void;
  /** Called when the user cancels / closes the draw mode */
  onClose: () => void;
  /**
   * True while the caller is capturing/compositing/uploading the annotated
   * screenshot for a just-submitted drawing (see the design app's
   * design-canvas/annotation-snapshot.ts). Disables Send and swaps its icon
   * for a spinner so a slow capture can't be triggered twice from the same
   * drawing. The entire overlay becomes inert while true so edits made after
   * the submitted snapshot cannot be erased when that submission is later
   * confirmed and the caller clears the batch.
   */
  sending?: boolean;
  /**
   * Bump this (e.g. a counter) exactly when the caller wants to discard the
   * current strokes/text annotations — after `onClose` or a confirmed Send.
   * Strokes/text are intentionally NOT cleared merely because `visible`
   * turns false: `visible` can toggle off for reasons that have nothing to
   * do with the user wanting to discard their work (switching tools, views,
   * or side panels), and doing so silently would destroy annotations the
   * user never got a chance to send. Only an in-progress (uncommitted)
   * gesture is reset on hide; a pending text label is committed so its typed
   * content survives.
   */
  clearSignal?: number;
  /**
   * Identity of the canvas this annotation batch belongs to. When the host
   * reuses one DrawOverlay instance for a different screen, the old batch is
   * cleared with a warning instead of being silently reinterpreted against
   * the new screen's pixels and submitted with the wrong screenshot.
   */
  scopeKey?: string;
  /**
   * Keep the canvas DOM/bitmap alive while hidden. Use for the one active
   * editor overlay whose work must survive mode/view toggles; leave false for
   * large preview grids so every dormant screen does not allocate a canvas
   * and ResizeObserver.
   */
  retainSurfaceWhenHidden?: boolean;
}

const PRESET_COLORS = [
  { color: "#ef4444", label: "Red" },
  { color: "#3b82f6", label: "Blue" },
  { color: "#22c55e", label: "Green" },
  { color: "#eab308", label: "Yellow" },
];

const LINE_WIDTHS = [
  { value: 2, label: "Thin" },
  { value: 4, label: "Medium" },
  { value: 8, label: "Thick" },
];

/**
 * A point stored as fractions (0..1) of the canvas visual rect.
 * This makes coordinates zoom- and resize-stable: multiply by the current
 * rect width/height to get visual pixels for canvas drawing, or multiply by
 * rect/scale to get layout-space for CSS positioning and pathData output.
 */
interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  /** Points stored as fractions (0..1) of the canvas visual rect. */
  points: Point[];
  color: string;
  lineWidth: number;
  /** Creation timestamp for unified undo ordering. */
  createdAt: number;
}

interface PendingTextInput {
  /** Fractional x (0..1) of the visual rect. */
  xFrac: number;
  /** Fractional y (0..1) of the visual rect. */
  yFrac: number;
  value: string;
  /**
   * Monotonic generation id. A click that opens a new pending text box while
   * an earlier one is still focused fires pointerdown (which replaces the
   * ref synchronously) before the outgoing box's native `blur` event runs.
   * Without this, that trailing blur reads the *new* (empty) pending input
   * out of the ref and wipes it via `commitTextAnnotation`'s unconditional
   * `setPendingTextInput(null)` before the user can type anything. Callers
   * pass the generation captured at their own render so a stale blur/Enter/
   * Escape from a since-replaced box is a no-op instead of clobbering the
   * newer one.
   */
  generation: number;
}

/**
 * Keep long pen/stylus gestures bounded before they become agent prompt data.
 * Once this limit is reached, older samples are progressively decimated while
 * preserving the first, latest, and future points. At normal pointer rates the
 * sub-pixel filter below is the only sampling users will notice.
 */
const MAX_STROKE_POINTS = 2048;
const MIN_POINT_DISTANCE_PX = 0.35;

function pointFromClient(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

function appendStrokePoint(
  points: Point[],
  point: Point,
  rect: DOMRect,
  force = false,
): Point[] {
  const last = points[points.length - 1];
  if (last) {
    const dx = (point.x - last.x) * rect.width;
    const dy = (point.y - last.y) * rect.height;
    const distanceSquared = dx * dx + dy * dy;
    if (
      distanceSquared === 0 ||
      (!force && distanceSquared < MIN_POINT_DISTANCE_PX ** 2)
    ) {
      return points;
    }
  }

  let next = points;
  if (next.length >= MAX_STROKE_POINTS) {
    // Preserve the full trajectory instead of dropping the tail of a long
    // gesture. Repeated compaction gradually lowers only the oldest sampling
    // density, which is visually preferable to a path that suddenly stops.
    const compacted: Point[] = [next[0]];
    for (let index = 2; index < next.length - 1; index += 2) {
      compacted.push(next[index]);
    }
    compacted.push(next[next.length - 1]);
    next = compacted;
  }

  next.push(point);
  return next;
}

/**
 * Draw-to-prompt overlay for the slide canvas.
 *
 * Mirrors claude.ai/design's "Draw mode": the user sketches on the canvas,
 * adds a one-line text instruction, hits Send, and the strokes + instruction
 * are forwarded to the agent. The agent receives the path geometry along with
 * the canvas size so it can interpret position semantically (e.g. "move the
 * title here").
 *
 * This component is canvas-agnostic — it overlays absolutely-positioned over
 * its parent, so the parent (a slide editor or design canvas) only needs to
 * be `position: relative`.
 *
 * Coordinate model
 * ----------------
 * All stroke points and text positions are stored as fractions (0..1) of the
 * canvas's visual rect (getBoundingClientRect). This makes them stable across
 * zoom and resize. When rendering:
 *   - Canvas strokes: multiply by rect.width / rect.height (visual pixels).
 *   - CSS text labels: multiply by rect.width/scale / rect.height/scale
 *     (layout pixels inside the scaled wrapper).
 *   - pathData in send(): layout pixels = fraction * rect.width / scale.
 */
export function DrawOverlay({
  visible,
  canvasInteractive = true,
  queuedAnnotationCount = 0,
  zoom = 100,
  onSend,
  onClose,
  sending = false,
  clearSignal,
  scopeKey,
  retainSurfaceWhenHidden = false,
}: DrawOverlayProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(PRESET_COLORS[0].color);
  const [lineWidth, setLineWidth] = useState(LINE_WIDTHS[1].value);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<DrawAnnotation[]>([]);
  const textAnnotationsRef = useRef<DrawAnnotation[]>([]);
  // Unified redo stack. Each entry is either a Stroke or a DrawAnnotation so
  // undo/redo work in creation order across both types.
  const [redoStack, setRedoStack] = useState<Array<Stroke | DrawAnnotation>>(
    [],
  );
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  // Pointer events can arrive down -> move -> up before React renders once.
  // This ref is the authoritative in-progress gesture; state is only a
  // frame-throttled snapshot used to redraw the canvas.
  const currentStrokeRef = useRef<Point[] | null>(null);
  const currentStrokeFrameRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeStrokeStyleRef = useRef({ color, lineWidth });
  const lastCreatedAtRef = useRef(0);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState<PendingTextInput | null>(null);
  const textInputStateRef = useRef<PendingTextInput | null>(null);
  const textInputGenerationRef = useRef(0);
  const textInputRef = useRef<HTMLInputElement>(null);
  // Escape cancels the pending text annotation, but unmounting the input also
  // fires its blur handler, which would commit the very annotation the user
  // just cancelled. This flag lets the blur handler skip that commit.
  const cancelingTextRef = useRef(false);
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef("");
  const drawing = useRef(false);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  // Resize tick: bumped by ResizeObserver so the redraw effect re-runs when
  // the canvas element's CSS size changes (e.g. device frame switch).
  const [resizeTick, setResizeTick] = useState(0);

  const scale = Math.max(zoom / 100, 0.01);

  // A host can still unmount the active editor entirely (route/design close,
  // or focused canvas teardown) rather than merely hiding this component.
  // Losing unsent work in that teardown must never be silent. Normal
  // overview/focused visibility changes retain their active surface and do
  // not hit this cleanup; only a real component unmount does.
  useEffect(() => {
    return () => {
      // A true unmount never runs the `!visible` effect above (the prop
      // never transitions — the component is simply gone), so a still-open
      // pending text box never gets its usual commit-on-hide chance. Count
      // it here too, or a label the user was mid-typing would vanish
      // without even counting toward the warning.
      const pendingText = textInputStateRef.current?.value.trim();
      const discardedCount =
        strokesRef.current.length +
        textAnnotationsRef.current.length +
        (pendingText ? 1 : 0) +
        (instructionRef.current.trim() ? 1 : 0);
      if (discardedCount > 0) {
        toast(
          t("visualEditor.annotationsDiscardedOnViewChange", {
            count: discardedCount,
          }),
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- must only run
    // its cleanup on actual unmount, not on every `t`/locale change.
  }, []);

  const cancelScheduledStrokeFrame = useCallback(() => {
    if (currentStrokeFrameRef.current === null) return;
    window.cancelAnimationFrame(currentStrokeFrameRef.current);
    currentStrokeFrameRef.current = null;
  }, []);

  const scheduleCurrentStrokeRedraw = useCallback(() => {
    if (currentStrokeFrameRef.current !== null) return;
    currentStrokeFrameRef.current = window.requestAnimationFrame(() => {
      currentStrokeFrameRef.current = null;
      const points = currentStrokeRef.current;
      setCurrentStroke(points ? [...points] : null);
    });
  }, []);

  const resetActiveStroke = useCallback(() => {
    drawing.current = false;
    activePointerIdRef.current = null;
    currentStrokeRef.current = null;
    cancelScheduledStrokeFrame();
    setCurrentStroke(null);
  }, [cancelScheduledStrokeFrame]);

  const nextCreatedAt = useCallback(() => {
    const next = Math.max(Date.now(), lastCreatedAtRef.current + 1);
    lastCreatedAtRef.current = next;
    return next;
  }, []);

  const setPendingTextInput = useCallback(
    (
      update:
        | PendingTextInput
        | null
        | ((current: PendingTextInput | null) => PendingTextInput | null),
    ) => {
      const next =
        typeof update === "function"
          ? update(textInputStateRef.current)
          : update;
      textInputStateRef.current = next;
      setTextInput(next);
    },
    [],
  );

  const clearAnnotationState = useCallback(() => {
    resetActiveStroke();
    strokesRef.current = [];
    textAnnotationsRef.current = [];
    setStrokes([]);
    setTextAnnotations([]);
    setRedoStack([]);
    setPendingTextInput(null);
    setTextMode(false);
    instructionRef.current = "";
    setInstruction("");
    cancelingTextRef.current = false;
    lastCreatedAtRef.current = 0;
    textInputGenerationRef.current = 0;
  }, [resetActiveStroke, setPendingTextInput]);

  // Hiding ends whatever the user was mid-gesture on, but must NOT discard
  // already-committed strokes/text: `visible` can turn false for reasons
  // that have nothing to do with the user wanting to abandon their
  // annotations (switching tools, views, or side panels). Only reset the
  // transient in-flight state here — the committed `strokes`/
  // `textAnnotations` arrays are cleared exclusively by `clearSignal` below.
  useEffect(() => {
    if (!visible) {
      resetActiveStroke();
      setTextMode(false);
      cancelingTextRef.current = false;
    }
  }, [resetActiveStroke, visible]);

  // Comment-pin mode can temporarily leave the toolbar visible while making
  // the drawing surface inert. Never retain a half-finished gesture across
  // that tool switch.
  useEffect(() => {
    if (!canvasInteractive) resetActiveStroke();
  }, [canvasInteractive, resetActiveStroke]);

  useEffect(
    () => () => {
      cancelScheduledStrokeFrame();
    },
    [cancelScheduledStrokeFrame],
  );

  const shouldFocusTextInput = textInput !== null;
  useEffect(() => {
    if (!visible || !shouldFocusTextInput) return;
    const id = window.requestAnimationFrame(() => {
      textInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [shouldFocusTextInput, visible]);

  // Retained editor surfaces keep their canvas mounted while hidden, so a
  // hidden-first host installs its observer and the bitmap does not flash
  // blank when the user re-enters annotate mode. Non-retained preview-grid
  // overlays attach only while visible to avoid idle canvas/observer cost.
  useEffect(() => {
    if (!visible && !retainSurfaceWhenHidden) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setResizeTick((t) => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [retainSurfaceWhenHidden, visible]);

  // Redraw before paint whenever strokes change, the canvas is resized, or a
  // preserved batch becomes visible again. The visible dependency is
  // intentional even though the DOM stays mounted: browsers may discard a
  // hidden canvas backing store under memory pressure, and re-entry must
  // never expose a blank frame before the next pointer event.
  useLayoutEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const newW = rect.width * dpr;
    const newH = rect.height * dpr;
    if (newW !== canvasSizeRef.current.w || newH !== canvasSizeRef.current.h) {
      canvas.width = newW;
      canvas.height = newH;
      canvasSizeRef.current = { w: newW, h: newH };
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Points are stored as fractions; multiply by current rect to get visual px.
    for (const stroke of strokes) {
      drawStroke(
        ctx,
        stroke.points.map((p) => ({
          x: p.x * rect.width,
          y: p.y * rect.height,
        })),
        stroke.color,
        stroke.lineWidth,
      );
    }

    if (currentStroke && currentStroke.length > 0) {
      const activeStyle = activeStrokeStyleRef.current;
      drawStroke(
        ctx,
        currentStroke.map((p) => ({
          x: p.x * rect.width,
          y: p.y * rect.height,
        })),
        activeStyle.color,
        activeStyle.lineWidth,
      );
    }
    // `zoom` is a dependency because it scales the canvas via a CSS transform,
    // which changes getBoundingClientRect() without firing ResizeObserver — the
    // effect must re-run on zoom change to redraw the fraction-based strokes at
    // the new visual size.
  }, [strokes, currentStroke, color, lineWidth, resizeTick, visible, zoom]);

  /**
   * Commits the pending text annotation (if any) and clears the pending
   * input. `expectedGeneration`, when passed, guards against a stale
   * blur/Enter/Escape belonging to a pending text box that has since been
   * replaced or already cleared — see `PendingTextInput.generation`. Called
   * with no argument to force-commit whatever is currently pending (e.g.
   * before opening a new text box, or right before Send).
   */
  const commitTextAnnotation = useCallback(
    (expectedGeneration?: number) => {
      const pendingText = textInputStateRef.current;
      if (
        !pendingText ||
        (expectedGeneration !== undefined &&
          pendingText.generation !== expectedGeneration)
      ) {
        return;
      }
      // Clear the authoritative pending value first. Enter, blur, and Send can
      // all occur in the same browser turn; any later handler becomes a no-op
      // instead of duplicating the label.
      setPendingTextInput(null);
      if (!pendingText.value.trim()) return;

      const ann: DrawAnnotation = {
        id: crypto.randomUUID(),
        type: "text",
        text: pendingText.value.trim(),
        // Store fractional position so the label stays anchored across zoom changes.
        position: { x: pendingText.xFrac, y: pendingText.yFrac },
        color,
        lineWidth,
        createdAt: nextCreatedAt(),
      };
      const nextTexts = [...textAnnotationsRef.current, ann];
      textAnnotationsRef.current = nextTexts;
      setTextAnnotations(nextTexts);
      // A new text annotation also clears the redo stack.
      setRedoStack([]);
    },
    [color, lineWidth, nextCreatedAt, setPendingTextInput],
  );

  // Hiding removes the pending-text input from interaction. Commit whatever
  // was typed explicitly so a still-open label survives an unrelated exit
  // instead of relying on incidental native blur ordering.
  useEffect(() => {
    if (!visible) commitTextAnnotation();
  }, [visible, commitTextAnnotation]);

  // The explicit-discard path: the caller bumps `clearSignal` exactly when
  // the user deliberately closes the overlay (X/Escape) or a Send is
  // confirmed delivered. A scope change below is the only other reset path,
  // guarding against submitting one screen's geometry against another.
  const lastClearSignalRef = useRef(clearSignal);
  useLayoutEffect(() => {
    if (clearSignal === lastClearSignalRef.current) return;
    lastClearSignalRef.current = clearSignal;
    clearAnnotationState();
  }, [clearAnnotationState, clearSignal]);

  const lastScopeKeyRef = useRef(scopeKey);
  useLayoutEffect(() => {
    if (scopeKey === lastScopeKeyRef.current) return;
    lastScopeKeyRef.current = scopeKey;
    const pendingText = textInputStateRef.current?.value.trim();
    const discardedCount =
      strokesRef.current.length +
      textAnnotationsRef.current.length +
      (pendingText ? 1 : 0) +
      (instructionRef.current.trim() ? 1 : 0);
    if (discardedCount > 0) {
      toast(
        t("visualEditor.annotationsDiscardedOnViewChange", {
          count: discardedCount,
        }),
      );
    }
    clearAnnotationState();
  }, [clearAnnotationState, scopeKey, t]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      if (!canvasInteractive || sending || drawing.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      if (textMode) {
        e.preventDefault();
        cancelingTextRef.current = false;
        // Commit whatever text box was still open (using the current ref,
        // which still holds the outgoing box at this point) before replacing
        // it, so clicking a new spot never silently drops the previous label.
        commitTextAnnotation();
        textInputGenerationRef.current += 1;
        setPendingTextInput({
          xFrac: (e.clientX - rect.left) / rect.width,
          yFrac: (e.clientY - rect.top) / rect.height,
          value: "",
          generation: textInputGenerationRef.current,
        });
        return;
      }

      const point = pointFromClient(e.clientX, e.clientY, rect);
      if (!point) return;
      e.preventDefault();
      drawing.current = true;
      activePointerIdRef.current = e.pointerId;
      activeStrokeStyleRef.current = { color, lineWidth };
      currentStrokeRef.current = [point];
      setCurrentStroke([point]);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture may fail if the browser already cancelled the
        // gesture. The pointer-id guard still prevents cross-pointer mixing.
      }
    },
    [
      canvasInteractive,
      color,
      commitTextAnnotation,
      lineWidth,
      sending,
      setPendingTextInput,
      textMode,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing.current || textMode) return;
      if (activePointerIdRef.current !== e.pointerId) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || !currentStrokeRef.current) return;

      const nativeEvent = e.nativeEvent;
      const coalesced = nativeEvent.getCoalescedEvents?.() ?? [];
      const samples = [...coalesced, nativeEvent];
      let points = currentStrokeRef.current;
      let changed = false;
      for (const sample of samples) {
        const point = pointFromClient(sample.clientX, sample.clientY, rect);
        if (!point) continue;
        const previousLength = points.length;
        const next = appendStrokePoint(points, point, rect);
        if (next !== points || next.length !== previousLength) changed = true;
        points = next;
      }
      currentStrokeRef.current = points;
      if (changed) scheduleCurrentStrokeRedraw();
    },
    [scheduleCurrentStrokeRedraw, textMode],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current || activePointerIdRef.current !== e.pointerId)
        return;

      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      let points = currentStrokeRef.current;
      if (rect && points) {
        const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const sample of [...coalesced, e.nativeEvent]) {
          const point = pointFromClient(sample.clientX, sample.clientY, rect);
          if (point) points = appendStrokePoint(points, point, rect, true);
        }
        currentStrokeRef.current = points;
      }

      drawing.current = false;
      activePointerIdRef.current = null;
      cancelScheduledStrokeFrame();
      if (points && points.length > 1) {
        const activeStyle = activeStrokeStyleRef.current;
        const stroke: Stroke = {
          id: crypto.randomUUID(),
          points: [...points],
          color: activeStyle.color,
          lineWidth: activeStyle.lineWidth,
          createdAt: nextCreatedAt(),
        };
        const nextStrokes = [...strokesRef.current, stroke];
        strokesRef.current = nextStrokes;
        setStrokes(nextStrokes);
        // A new stroke clears the redo stack (standard editor convention).
        setRedoStack([]);
      }
      currentStrokeRef.current = null;
      setCurrentStroke(null);

      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // The browser can release capture before React handles pointerup.
      }
    },
    [cancelScheduledStrokeFrame, nextCreatedAt],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      resetActiveStroke();
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Pointer cancellation often releases capture before this event.
      }
    },
    [resetActiveStroke],
  );

  const handleLostPointerCapture = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (drawing.current && activePointerIdRef.current === e.pointerId) {
        resetActiveStroke();
      }
    },
    [resetActiveStroke],
  );

  /**
   * Undo removes the most recently created annotation (stroke or text) in
   * creation order and pushes it onto the unified redo stack.
   */
  const undo = () => {
    if (sending) return;
    const currentStrokes = strokesRef.current;
    const currentTexts = textAnnotationsRef.current;
    const lastStroke =
      currentStrokes.length > 0
        ? currentStrokes[currentStrokes.length - 1]
        : null;
    const lastText =
      currentTexts.length > 0 ? currentTexts[currentTexts.length - 1] : null;

    if (!lastStroke && !lastText) return;

    // Remove whichever was created most recently.
    const strokeTime = lastStroke?.createdAt ?? -Infinity;
    const textTime = lastText?.createdAt ?? 0;

    if (lastStroke && strokeTime >= textTime) {
      const nextStrokes = currentStrokes.slice(0, -1);
      strokesRef.current = nextStrokes;
      setStrokes(nextStrokes);
      setRedoStack((stack) => [...stack, lastStroke]);
    } else if (lastText) {
      const nextTexts = currentTexts.slice(0, -1);
      textAnnotationsRef.current = nextTexts;
      setTextAnnotations(nextTexts);
      setRedoStack((stack) => [...stack, lastText]);
    }
  };

  const redo = () => {
    if (sending) return;
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const top = stack[stack.length - 1];
      const remaining = stack.slice(0, -1);
      if ("points" in top) {
        // It's a Stroke
        const nextStrokes = [...strokesRef.current, top as Stroke];
        strokesRef.current = nextStrokes;
        setStrokes(nextStrokes);
      } else {
        // It's a DrawAnnotation (text)
        const nextTexts = [
          ...textAnnotationsRef.current,
          top as DrawAnnotation,
        ];
        textAnnotationsRef.current = nextTexts;
        setTextAnnotations(nextTexts);
      }
      return remaining;
    });
  };

  const clear = () => {
    if (sending) return;
    if (strokes.length === 0 && textAnnotations.length === 0) return;
    const prevStrokes = strokesRef.current;
    const prevTexts = textAnnotationsRef.current;
    const prevRedo = redoStack;
    strokesRef.current = [];
    textAnnotationsRef.current = [];
    setStrokes([]);
    setTextAnnotations([]);
    setRedoStack([]);
    toast(t("visualEditor.clearedAllAnnotations"), {
      action: {
        label: t("visualEditor.undo"),
        onClick: () => {
          // Merge snapshot with any strokes/texts drawn during the toast window
          // so new work is not discarded; also restore the pre-clear redo stack.
          const restoredStrokes = [...prevStrokes, ...strokesRef.current];
          const restoredTexts = [...prevTexts, ...textAnnotationsRef.current];
          strokesRef.current = restoredStrokes;
          textAnnotationsRef.current = restoredTexts;
          setStrokes(restoredStrokes);
          setTextAnnotations(restoredTexts);
          setRedoStack(prevRedo);
        },
      },
      duration: 6000,
    });
  };

  const send = () => {
    if (sending) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A focused text label normally commits on blur before the Send click, but
    // keyboard/programmatic activation does not guarantee that ordering.
    commitTextAnnotation();
    const rect = canvas.getBoundingClientRect();
    // Layout-space dimensions = visual rect / scale factor.
    const layoutW = rect.width / scale;
    const layoutH = rect.height / scale;

    const pathAnnotations: DrawAnnotation[] = strokesRef.current.map((s) => ({
      id: s.id,
      type: "path",
      // Convert fractional points to layout-space absolute pixels for the agent.
      pathData: s.points
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"}${(p.x * layoutW).toFixed(1)},${(p.y * layoutH).toFixed(1)}`,
        )
        .join(" "),
      color: s.color,
      lineWidth: s.lineWidth,
      position: { x: 0, y: 0 },
    }));

    // Convert fractional text positions to layout-space absolute pixels.
    const layoutTextAnnotations: DrawAnnotation[] =
      textAnnotationsRef.current.map((a) => ({
        ...a,
        position: {
          x: a.position.x * layoutW,
          y: a.position.y * layoutH,
        },
      }));

    const all = [...pathAnnotations, ...layoutTextAnnotations];
    if (all.length === 0 && !instruction.trim() && queuedAnnotationCount === 0)
      return;

    onSend(all, instruction.trim(), {
      width: layoutW,
      height: layoutH,
    });
  };

  if (!visible && !retainSurfaceWhenHidden) return null;

  const hasContent =
    strokes.length > 0 ||
    textAnnotations.length > 0 ||
    !!textInput?.value.trim() ||
    instruction.trim() ||
    queuedAnnotationCount > 0;

  const canUndo = strokes.length > 0 || textAnnotations.length > 0;
  const canRedo = redoStack.length > 0;

  const toolbar = (
    <div
      data-draw-toolbar
      className="pointer-events-auto fixed bottom-20 left-1/2 z-[110] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-2xl"
    >
      {/* Color picker */}
      <div className="flex gap-1">
        {PRESET_COLORS.map((preset) => (
          <Tooltip key={preset.color}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={preset.label}
                data-testid={`draw-color-${preset.label.toLowerCase()}`}
                onClick={() => {
                  if (!sending) setColor(preset.color);
                }}
                disabled={sending}
                className={cn(
                  "h-5 w-5 cursor-pointer rounded-full",
                  color === preset.color
                    ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                    : "ring-1 ring-border",
                )}
                style={{ backgroundColor: preset.color }}
              />
            </TooltipTrigger>
            <TooltipContent>{preset.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Line widths */}
      <div className="flex gap-1">
        {LINE_WIDTHS.map((lw) => (
          <Tooltip key={lw.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={lw.label}
                data-testid={`draw-line-width-${lw.label.toLowerCase()}`}
                onClick={() => {
                  if (!sending) setLineWidth(lw.value);
                }}
                disabled={sending}
                className={cn(
                  "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
                  lineWidth === lw.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: lw.value + 2, height: lw.value + 2 }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{lw.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Text mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.typeAnywhereOnCanvas")}
            data-testid="draw-text-mode"
            onClick={() => {
              if (!sending) setTextMode(!textMode);
            }}
            disabled={sending}
            className={cn(
              "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
              textMode
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <IconCursorText className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {t("visualEditor.typeAnywhereOnCanvas")}
        </TooltipContent>
      </Tooltip>

      {/* Undo last annotation (stroke or text) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.undoStroke")}
            data-testid="draw-undo"
            onClick={undo}
            disabled={!canUndo || sending}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          >
            <IconArrowBackUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.undoStroke")}</TooltipContent>
      </Tooltip>

      {/* Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.redoStroke")}
            data-testid="draw-redo"
            onClick={redo}
            disabled={!canRedo || sending}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          >
            <IconArrowForwardUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.redoStroke")}</TooltipContent>
      </Tooltip>

      {/* Clear all */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.clearAll")}
            data-testid="draw-clear-all"
            onClick={clear}
            disabled={
              sending || (strokes.length === 0 && textAnnotations.length === 0)
            }
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          >
            <IconEraser className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.clearAll")}</TooltipContent>
      </Tooltip>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Instruction input */}
      <Input
        value={instruction}
        onChange={(e) => {
          if (sending) return;
          instructionRef.current = e.target.value;
          setInstruction(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hasContent && !sending) send();
          if (e.key === "Escape") onClose();
        }}
        placeholder={t("visualEditor.tellAgentWhatToDo")}
        disabled={sending}
        className="h-7 w-56 border-border bg-background text-xs"
      />

      {/* Send */}
      <Button
        size="sm"
        data-testid="draw-send"
        className="h-7 gap-1 px-3 !text-[11px] cursor-pointer"
        onClick={send}
        disabled={!hasContent || sending}
      >
        {sending ? (
          <IconLoader2 className="h-3 w-3 animate-spin" />
        ) : (
          <IconSend className="h-3 w-3" />
        )}
        {sending ? t("visualEditor.sendingDrawing") : t("visualEditor.send")}
      </Button>

      {/* Close */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.exitDrawMode")}
            data-testid="draw-exit"
            onClick={onClose}
            disabled={sending}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.exitDrawMode")}</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-draw-overlay
      aria-hidden={!visible}
      className={cn(
        "absolute inset-0 z-[100]",
        visible ? "visible" : "invisible pointer-events-none",
        canvasInteractive && !sending
          ? "pointer-events-auto"
          : "pointer-events-none",
      )}
    >
      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        data-draw-canvas
        className={cn(
          "absolute inset-0 h-full w-full touch-none",
          textMode ? "cursor-text" : "cursor-crosshair",
          (!canvasInteractive || sending) && "pointer-events-none",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
      />

      {/* Rendered text annotations.
          Positions are stored as fractions (0..1) of the visual rect. Convert
          to layout-space pixels (fraction * visualDim / scale) so the label
          sits at the right layout position inside the scaled wrapper, where
          CSS left/top are interpreted in pre-scale coordinates. */}
      {textAnnotations.map((ann) => {
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const layoutX = rect
          ? (ann.position.x * rect.width) / scale
          : ann.position.x;
        const layoutY = rect
          ? (ann.position.y * rect.height) / scale
          : ann.position.y;
        return (
          <div
            key={ann.id}
            className="absolute pointer-events-none select-none whitespace-nowrap font-semibold"
            style={{
              left: layoutX,
              top: layoutY,
              color: ann.color,
              fontSize: 14 + ann.lineWidth,
            }}
          >
            {ann.text}
          </div>
        );
      })}

      {/* Pending text input — positioned at the click point in layout space. */}
      {textInput &&
        (() => {
          const canvas = canvasRef.current;
          const rect = canvas?.getBoundingClientRect();
          const layoutX = rect
            ? (textInput.xFrac * rect.width) / scale
            : textInput.xFrac;
          const layoutY = rect
            ? (textInput.yFrac * rect.height) / scale
            : textInput.yFrac;
          return (
            <div
              className="pointer-events-auto absolute z-40"
              style={{ left: layoutX, top: layoutY }}
            >
              <Input
                ref={textInputRef}
                value={textInput.value}
                onChange={(e) =>
                  !sending &&
                  setPendingTextInput((prev) =>
                    prev ? { ...prev, value: e.target.value } : null,
                  )
                }
                onBlur={() => {
                  // Escape unmounts the input, which fires this blur — skip
                  // the commit for a cancelled annotation.
                  if (cancelingTextRef.current) {
                    cancelingTextRef.current = false;
                    return;
                  }
                  // Pass this render's generation so a trailing blur that
                  // arrives after pointerdown has already opened a *newer*
                  // text box (see PendingTextInput.generation) is a no-op
                  // instead of wiping the box the user just started typing.
                  commitTextAnnotation(textInput.generation);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Committing unmounts the focused input, which can emit a
                    // blur event in the same turn. Skip that second commit.
                    cancelingTextRef.current = true;
                    commitTextAnnotation(textInput.generation);
                  }
                  if (e.key === "Escape") {
                    cancelingTextRef.current = true;
                    setPendingTextInput(null);
                  }
                }}
                className="h-7 w-48 border-primary bg-background text-sm"
                disabled={sending}
                autoFocus
                placeholder={t("visualEditor.typeAnnotationFancy")}
              />
            </div>
          );
        })()}

      {visible ? <DrawToolbarPortal>{toolbar}</DrawToolbarPortal> : null}
    </div>
  );
}

function DrawToolbarPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  lineWidth: number,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}
