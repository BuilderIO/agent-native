import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type BubbleSize = "small" | "medium";

/**
 * Draggable, circular camera bubble — a PURE RENDERER.
 *
 * # Why we don't call getUserMedia here
 *
 * Tauri v2's macOS backend runs every webview window inside a single
 * WebKit process. WebKit enforces a documented single-page
 * capture-exclusion policy: when one page calls `getDisplayMedia` or
 * `getUserMedia`, all capture sources in OTHER pages in the same
 * process are MUTED — the track stays `readyState="live"` but frames
 * stop arriving (see WebKit bugs 179363, 237359, 212040, 238456;
 * changeset 271154). Earlier attempts worked around this with onmute
 * listeners, watchdogs, luma probes, cooldowns, and
 * destroy-and-respawn dances — none held up reliably because the
 * underlying behavior is intentional in WebKit.
 *
 * The robust fix is architectural: the POPOVER owns the camera (it
 * also owns the display-capture session, so "same page" applies), and
 * streams JPEG frames to this overlay via Tauri events. This
 * component just listens for `clips:bubble-frame`, decodes each
 * payload to an ImageBitmap, and blits it onto a `<canvas>`. No
 * getUserMedia, no track lifecycle, no watchdog.
 *
 * Frame format (emitted by `recorder.ts`):
 *   {
 *     bytes: number[]   // JPEG bytes (each entry 0–255)
 *     w:     number     // source width  (e.g. 256)
 *     h:     number     // source height (e.g. 256)
 *   }
 *
 * # Hover controls (Loom-style)
 *
 * On pointerenter, a small horizontal pill fades in under the bubble
 * with two size-dot buttons (small / medium) and an X close button.
 * Clicking a dot calls `set_bubble_size` on the Rust side, which
 * resizes this window and persists the choice to disk. On
 * pointerleave the pill fades back out after ~400ms — matches Loom's
 * dwell timing so a brief cursor wander off the bubble doesn't yank
 * the controls away mid-reach.
 */
export function Bubble() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstFrameAtRef = useRef<number | null>(null);
  const [size, setSize] = useState<BubbleSize>("medium");
  const [showControls, setShowControls] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- initial size fetch -------------------------------------------------
  // Rust already sized the Tauri window on spawn based on the saved size;
  // we just need to mirror that choice into React state so the canvas +
  // control pill render at the matching CSS dimensions.
  useEffect(() => {
    let cancelled = false;
    invoke<string>("load_bubble_size")
      .then((value) => {
        if (cancelled) return;
        setSize(value === "small" ? "small" : "medium");
      })
      .catch((err) => {
        console.warn("[bubble] load_bubble_size failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- hover controls -----------------------------------------------------
  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setShowControls(true);
  };
  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    // ~400ms dwell matches Loom — short enough to feel responsive, long
    // enough that a quick cursor detour doesn't yank the controls away.
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      setShowControls(false);
    }, 400);
  };
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // ---- size change --------------------------------------------------------
  const pickSize = async (next: BubbleSize) => {
    if (next === size) return;
    try {
      await invoke("set_bubble_size", { size: next });
      setSize(next);
    } catch (err) {
      console.warn("[bubble] set_bubble_size failed", err);
    }
  };

  // ---- close --------------------------------------------------------------
  const onClose = async () => {
    // Let the popover clear its `cameraOn` state — the session effect
    // then tears down the stream + pump cleanly. Emit first so the
    // popover gets the signal before the webview is destroyed.
    try {
      await emit("clips:bubble-closed");
    } catch (err) {
      console.warn("[bubble] emit bubble-closed failed", err);
    }
    try {
      await invoke("close_bubble");
    } catch (err) {
      console.warn("[bubble] close_bubble failed", err);
    }
  };

  // ---- frame sink ---------------------------------------------------------
  useEffect(() => {
    const unlistens: Array<() => void> = [];

    listen<{ bytes: number[]; w: number; h: number }>(
      "clips:bubble-frame",
      async (ev) => {
        const { bytes, w, h } = ev.payload;
        if (!bytes || !bytes.length) return;
        if (firstFrameAtRef.current == null) {
          firstFrameAtRef.current = Date.now();
          console.log("[bubble] first frame received size=", bytes.length);
        } else {
          // Log every ~60 frames so we can confirm frames are landing
          // without spamming the console.
          const age = Date.now() - firstFrameAtRef.current;
          if (age % 3000 < 60) {
            console.log("[bubble] frame received size=", bytes.length);
          }
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        // Size the canvas buffer to the incoming frame size once (source
        // resolution is constant for a given recording). The CSS sizes
        // the canvas to the bubble's display size; the buffer stays at
        // the source resolution so we don't upscale on GPU.
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;

        try {
          const u8 = new Uint8Array(bytes);
          const blob = new Blob([u8], { type: "image/jpeg" });
          const bitmap = await createImageBitmap(blob);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            bitmap.close();
            return;
          }
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
        } catch (err) {
          console.warn("[bubble] frame decode failed", err);
        }
      },
    ).then((u) => unlistens.push(u));

    // Keep `clips:bubble-config` as a no-op legacy listener so emits
    // from older code paths don't blow up. The popover now picks the
    // device itself before calling getUserMedia, so there's nothing for
    // the bubble to configure.
    listen("clips:bubble-config", (ev) => {
      console.log("[bubble] bubble-config (legacy, ignored)", ev.payload);
    }).then((u) => unlistens.push(u));

    return () => unlistens.forEach((u) => u());
  }, []);

  // ---- position persistence ----------------------------------------------
  // Persist the bubble's position whenever the user drags it. Tauri fires
  // `onMoved` during the drag AND during OS-level window animations (the
  // window server interpolates position changes), so we debounce by 400ms —
  // long enough to coalesce a drag-gesture's worth of events into a single
  // disk write, short enough that a quick drop+quit still saves.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSaved: { x: number; y: number } | null = null;

    const scheduleSave = (x: number, y: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        // Dedupe — onMoved fires on show() too, no sense rewriting the
        // same JSON blob every launch.
        if (lastSaved && lastSaved.x === x && lastSaved.y === y) return;
        lastSaved = { x, y };
        void invoke("save_bubble_position", { x, y }).catch((err) => {
          console.warn("[bubble] save_bubble_position failed", err);
        });
      }, 400);
    };

    const win = getCurrentWindow();
    win
      .onMoved((e) => {
        const { x, y } = e.payload;
        scheduleSave(x, y);
      })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch((err) => {
        console.warn("[bubble] onMoved listener failed", err);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (unlisten) unlisten();
    };
  }, []);

  return (
    // The ENTIRE wrapper is a drag region — Tauri's macOS backend treats any
    // mousedown on an element with `data-tauri-drag-region` as drag-initiation
    // UNLESS the event path passes through a descendant marked
    // `data-tauri-drag-region="false"`. Putting the drag marker on a deeper
    // child (like `.bubble-root`) was unreliable because the hover wrapper's
    // pointer events + the mousedown path made Tauri see the event on the
    // wrapper first. Moving the marker to the wrapper gives us a single,
    // consistent source of "is this a drag?" truth — and the interactive
    // children (close X, dot buttons) opt out explicitly below.
    <div
      className={`bubble-wrapper bubble-${size}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={() => {
        // Diagnostic: this fires on every mousedown on the wrapper.
        // If you see "[bubble] mousedown on drag region" but the window
        // still doesn't move, the capability or NSWindow setup is the
        // problem — not the React/CSS layer.
        console.log("[bubble] mousedown on drag region");
      }}
      data-tauri-drag-region
    >
      <div className="bubble-root" data-tauri-drag-region>
        {/*
         * <canvas> has `pointer-events: none` in CSS so mousedown falls
         * through to the drag-region wrapper. Still tag it explicitly as a
         * drag region for defense-in-depth — some WKWebView versions have
         * latched event targets that ignore pointer-events on the first
         * click of an unfocused window.
         */}
        <canvas
          ref={canvasRef}
          className="bubble-video"
          data-tauri-drag-region
        />
        {/* Close X — top-right of bubble, only visible on hover. Explicitly
            opts OUT of drag so clicking the X fires onClick instead of
            kicking off a window drag. */}
        <button
          type="button"
          className={`bubble-close ${showControls ? "is-visible" : ""}`}
          onClick={onClose}
          aria-label="Close camera"
          title="Close camera"
          data-tauri-drag-region="false"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1L9 9M9 1L1 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {/* Size control pill — fades in under the bubble on hover. Sits in
          the wrapper (outside the drag-region circle) so its buttons
          receive pointer events normally without triggering a drag. */}
      <div
        className={`bubble-controls ${showControls ? "is-visible" : ""}`}
        data-tauri-drag-region="false"
      >
        <button
          type="button"
          className={`bubble-dot bubble-dot-small ${size === "small" ? "is-active" : ""}`}
          onClick={() => pickSize("small")}
          aria-label="Small camera"
          title="Small"
          data-tauri-drag-region="false"
        />
        <button
          type="button"
          className={`bubble-dot bubble-dot-medium ${size === "medium" ? "is-active" : ""}`}
          onClick={() => pickSize("medium")}
          aria-label="Medium camera"
          title="Medium"
          data-tauri-drag-region="false"
        />
      </div>
    </div>
  );
}
