import {
  canvasToScreenPoint,
  getRulerTicks,
  type CanvasCamera,
} from "@shared/canvas-math";
import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

const RULER_THICKNESS_PX = 20;
const TICK_LENGTH_PX = 8;
const SELECTION_LABEL_GAP_PX = 2;
const SELECTION_LABEL_CHAR_PX = 6;

export interface RulerSelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RulerSelectionAxisExtent {
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
}

/** Where a selection's edges land on each ruler, in surface pixels. */
export function getRulerSelectionExtent(
  camera: CanvasCamera,
  bounds: RulerSelectionBounds,
  canvasPadding: number,
): { x: RulerSelectionAxisExtent; y: RulerSelectionAxisExtent } {
  const start = canvasToScreenPoint(
    { x: bounds.left, y: bounds.top },
    camera,
    undefined,
    canvasPadding,
  );
  const end = canvasToScreenPoint(
    { x: bounds.right, y: bounds.bottom },
    camera,
    undefined,
    canvasPadding,
  );
  const label = (value: number) => String(Math.round(value));
  return {
    x: {
      start: start.x,
      end: end.x,
      startLabel: label(bounds.left),
      endLabel: label(bounds.right),
    },
    y: {
      start: start.y,
      end: end.y,
      startLabel: label(bounds.top),
      endLabel: label(bounds.bottom),
    },
  };
}

const selectionLabelWidth = (label: string) =>
  label.length * SELECTION_LABEL_CHAR_PX + SELECTION_LABEL_GAP_PX * 2;

// The rulers sit over the canvas surface, whose own pointer handlers start a
// marquee. A native listener stops the press at the ruler before any canvas
// listener (native or React) sees it. Guides have no model yet, so a press
// here does nothing else.
const blockCanvasPress = (element: HTMLDivElement | null) => {
  if (!element) return;
  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  element.addEventListener("pointerdown", stop);
  element.addEventListener("mousedown", stop);
};

export interface CanvasRulersHandle {
  setCamera: (camera: CanvasCamera) => void;
}

interface CanvasRulersProps {
  panX: number;
  panY: number;
  zoom: number;
  width: number;
  height: number;
  canvasPadding: number;
  insetLeft?: number;
  insetRight?: number;
  /** Canvas-unit bounds of the selection, highlighted on both rulers. */
  selectionBounds?: RulerSelectionBounds | null;
}

interface CameraState {
  live: CanvasCamera;
  committed: CanvasCamera;
}

const sameCamera = (a: CanvasCamera, b: CanvasCamera) =>
  a.x === b.x && a.y === b.y && a.zoom === b.zoom;

// The parent moves the camera imperatively during wheel/pinch gestures and
// only commits React state afterwards; `setCamera` keeps the rulers in step
// with the canvas instead of freezing until the gesture ends.
export const CanvasRulers = memo(
  forwardRef<CanvasRulersHandle, CanvasRulersProps>(function CanvasRulers(
    {
      panX,
      panY,
      zoom,
      width,
      height,
      canvasPadding,
      insetLeft = 0,
      insetRight = 0,
      selectionBounds,
    },
    ref,
  ) {
    const committed = useMemo(
      () => ({ x: panX, y: panY, zoom }),
      [panX, panY, zoom],
    );
    const [state, setState] = useState<CameraState>({
      live: committed,
      committed,
    });
    if (!sameCamera(state.committed, committed)) {
      setState({ live: committed, committed });
    }
    useImperativeHandle(
      ref,
      () => ({
        setCamera: (camera) =>
          setState((current) =>
            sameCamera(current.live, camera)
              ? current
              : { ...current, live: camera },
          ),
      }),
      [],
    );

    const { live } = state;
    const ticks = useMemo(
      () => getRulerTicks(live, { width, height }, { canvasPadding }),
      [live, width, height, canvasPadding],
    );
    const selection = useMemo(
      () =>
        selectionBounds
          ? getRulerSelectionExtent(live, selectionBounds, canvasPadding)
          : null,
      [live, selectionBounds, canvasPadding],
    );
    const barRef = useCallback(blockCanvasPress, []);
    const barClass =
      "pointer-events-auto absolute overflow-hidden bg-[var(--design-editor-panel-bg)] border-border";
    const selectionBandClass =
      "fill-[var(--design-editor-accent-color)] opacity-20";
    const selectionLabelClass = "fill-[var(--design-editor-accent-color)]";
    const selectionMaskClass = "fill-[var(--design-editor-panel-bg)]";
    return (
      <div
        aria-hidden="true"
        data-canvas-rulers
        className="pointer-events-none absolute inset-0 z-[95] select-none text-[10px] tabular-nums"
      >
        <div
          ref={barRef}
          data-canvas-ruler="x"
          className={`${barClass} border-b`}
          style={{
            left: insetLeft,
            right: insetRight,
            top: 0,
            height: RULER_THICKNESS_PX,
          }}
        >
          <svg className="size-full">
            {ticks.x.map((tick) => {
              const x = tick.position - insetLeft;
              if (x < RULER_THICKNESS_PX) return null;
              return (
                <g key={tick.value}>
                  <line
                    x1={x}
                    x2={x}
                    y1={RULER_THICKNESS_PX - TICK_LENGTH_PX}
                    y2={RULER_THICKNESS_PX}
                    className="stroke-muted-foreground"
                  />
                  <text x={x + 3} y={9} className="fill-muted-foreground">
                    {tick.label}
                  </text>
                </g>
              );
            })}
            {selection ? (
              <g>
                <rect
                  data-ruler-selection-band
                  x={selection.x.start - insetLeft}
                  y={0}
                  width={Math.max(0, selection.x.end - selection.x.start)}
                  height={RULER_THICKNESS_PX}
                  className={selectionBandClass}
                />
                {(
                  [
                    [selection.x.start, selection.x.startLabel, "end"],
                    [selection.x.end, selection.x.endLabel, "start"],
                  ] as const
                ).map(([edge, label, anchor]) => {
                  const x = edge - insetLeft;
                  const labelWidth = selectionLabelWidth(label);
                  const textX =
                    anchor === "end"
                      ? x - SELECTION_LABEL_GAP_PX
                      : x + SELECTION_LABEL_GAP_PX;
                  return (
                    <g key={anchor}>
                      <rect
                        x={anchor === "end" ? x - labelWidth : x}
                        y={0}
                        width={labelWidth}
                        height={RULER_THICKNESS_PX - TICK_LENGTH_PX}
                        className={selectionMaskClass}
                      />
                      <text
                        data-ruler-selection-label
                        x={textX}
                        y={9}
                        textAnchor={anchor}
                        className={selectionLabelClass}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            ) : null}
          </svg>
        </div>
        <div
          ref={barRef}
          data-canvas-ruler="y"
          className={`${barClass} border-r`}
          style={{
            left: insetLeft,
            top: RULER_THICKNESS_PX,
            bottom: 0,
            width: RULER_THICKNESS_PX,
          }}
        >
          <svg className="size-full">
            {ticks.y.map((tick) => {
              const y = tick.position - RULER_THICKNESS_PX;
              if (y < 0) return null;
              return (
                <g key={tick.value}>
                  <line
                    x1={RULER_THICKNESS_PX - TICK_LENGTH_PX}
                    x2={RULER_THICKNESS_PX}
                    y1={y}
                    y2={y}
                    className="stroke-muted-foreground"
                  />
                  <text
                    transform={`translate(9 ${y + 3}) rotate(-90)`}
                    textAnchor="end"
                    className="fill-muted-foreground"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}
            {selection ? (
              <g>
                <rect
                  data-ruler-selection-band
                  x={0}
                  y={selection.y.start - RULER_THICKNESS_PX}
                  width={RULER_THICKNESS_PX}
                  height={Math.max(0, selection.y.end - selection.y.start)}
                  className={selectionBandClass}
                />
                {(
                  [
                    [selection.y.start, selection.y.startLabel, "start"],
                    [selection.y.end, selection.y.endLabel, "end"],
                  ] as const
                ).map(([edge, label, anchor]) => {
                  // Rotated -90deg, an "end" anchor runs down from its point.
                  const y = edge - RULER_THICKNESS_PX;
                  const labelWidth = selectionLabelWidth(label);
                  const textY =
                    anchor === "start"
                      ? y - SELECTION_LABEL_GAP_PX
                      : y + SELECTION_LABEL_GAP_PX;
                  return (
                    <g key={anchor}>
                      <rect
                        x={0}
                        y={anchor === "start" ? y - labelWidth : y}
                        width={RULER_THICKNESS_PX - TICK_LENGTH_PX}
                        height={labelWidth}
                        className={selectionMaskClass}
                      />
                      <text
                        data-ruler-selection-label
                        transform={`translate(9 ${textY}) rotate(-90)`}
                        textAnchor={anchor}
                        className={selectionLabelClass}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            ) : null}
          </svg>
        </div>
        <div
          ref={barRef}
          className={`${barClass} border-b border-r`}
          style={{
            left: insetLeft,
            top: 0,
            width: RULER_THICKNESS_PX,
            height: RULER_THICKNESS_PX,
          }}
        />
      </div>
    );
  }),
);
