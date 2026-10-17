import { getRulerTicks, type CanvasCamera } from "@shared/canvas-math";
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

const RULER_THICKNESS_PX = 20;
const TICK_LENGTH_PX = 8;

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
    const barClass =
      "absolute overflow-hidden bg-[var(--design-editor-panel-bg)] border-border";
    return (
      <div
        aria-hidden="true"
        data-canvas-rulers
        className="pointer-events-none absolute inset-0 z-[95] select-none text-[10px] tabular-nums"
      >
        <div
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
          </svg>
        </div>
        <div
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
          </svg>
        </div>
        <div
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
