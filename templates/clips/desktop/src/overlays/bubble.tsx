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
 * Frame format (emitted by `bubble-pump.ts`):
 *   {
 *     dataUrl: string   // "data:image/jpeg;base64,..." (base64 JPEG)
 *     w:       number   // source width  (192 preview / 144 recording)
 *     h:       number   // source height (always equals w — square crop)
 *   }
 *
 * The pump previously sent `bytes: number[]` (a raw JS number array of
 * JPEG bytes), which was slow to JSON-stringify on the sender and
 * required a Blob → createImageBitmap round trip on the receiver. The
 * data-URL path cuts both costs: Tauri serializes one string in O(n),
 * and decoding via an `<img>` element lets WebKit decode off-main-
 * thread. A `bytes` fallback branch is kept below so a stale popover
 * build can still drive this bubble.
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
  // Small is the default bubble size — matches the Rust-side default in
  // `load_bubble_size_name`. On mount we `invoke("load_bubble_size")` to
  // read the persisted choice and override this if the user previously
  // picked medium.
  const [size, setSize] = useState<BubbleSize>("small");
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
        // Default is "small" — mirrors the Rust-side fallback. Only a
        // stored "medium" flips us to the larger circle; anything else
        // (including a corrupted JSON blob) stays small.
        setSize(value === "medium" ? "medium" : "small");
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

    // Two-slot `<img>` pool. The previous implementation used a single
    // `<img>` and reassigned `.src` each frame — which CANCELS the in-
    // flight decode in WebKit when the new .src lands. Under load, that
    // meant we often threw away half the decoded frames because the
    // next one arrived before the previous finished decoding.
    //
    // With two slots we alternate: slot A decodes → render → slot A is
    // free; slot B decodes next → render. Each decode gets to finish,
    // even when frames arrive close together. The useful work done by
    // one decode is no longer invalidated by the following frame.
    //
    // `.decoding = "async"` + `.decode()` (on Safari since ~15) pushes
    // JPEG decode off the main thread entirely. Using the returned
    // Promise also makes this more robust than `.onload` — a decode
    // error rejects rather than silently dropping the frame.
    type ImgSlot = {
      img: HTMLImageElement;
      busy: boolean;
    };
    const slots: ImgSlot[] = [
      { img: new Image(), busy: false },
      { img: new Image(), busy: false },
    ];
    for (const s of slots) {
      s.img.decoding = "async";
    }

    // Keep only the most recent pending dataUrl. If a frame arrives
    // while both slots are busy (rare, but possible when the sender
    // bursts a frame right as a previous one is still decoding), we
    // just remember the latest and dispatch it when a slot frees up.
    // We always want the NEWEST frame — an older queued frame would
    // be stale by the time it renders.
    let latestPending: { dataUrl: string; w: number; h: number } | null = null;

    function drawFromSlot(slot: ImgSlot, w: number, h: number) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        ctx.drawImage(slot.img, 0, 0, canvas.width, canvas.height);
      } catch (err) {
        console.warn("[bubble] frame drawImage failed", err);
      }
    }

    function dispatchPending() {
      if (!latestPending) return;
      const freeSlot = slots.find((s) => !s.busy);
      if (!freeSlot) return;
      const { dataUrl, w, h } = latestPending;
      latestPending = null;
      freeSlot.busy = true;
      freeSlot.img.src = dataUrl;
      // `img.decode()` returns a Promise that resolves once the image
      // is fully decoded and ready to draw. On Safari this work
      // happens on a background thread, so awaiting it here doesn't
      // block the main thread beyond the actual drawImage call.
      const decodePromise = freeSlot.img.decode
        ? freeSlot.img.decode()
        : new Promise<void>((resolve, reject) => {
            freeSlot.img.onload = () => resolve();
            freeSlot.img.onerror = (err) => reject(err);
          });
      decodePromise
        .then(() => {
          drawFromSlot(freeSlot, w, h);
        })
        .catch((err) => {
          console.warn("[bubble] frame img decode failed", err);
        })
        .finally(() => {
          freeSlot.busy = false;
          // Drain any frame that arrived mid-decode.
          if (latestPending) dispatchPending();
        });
    }

    listen<{
      dataUrl?: string;
      bytes?: number[];
      w: number;
      h: number;
    }>("clips:bubble-frame", async (ev) => {
      const { dataUrl, bytes, w, h } = ev.payload;

      if (firstFrameAtRef.current == null) {
        firstFrameAtRef.current = Date.now();
        console.log(
          "[bubble] first frame received path=",
          dataUrl ? "dataUrl" : "bytes",
        );
      } else {
        // Log every ~3s so we can confirm frames are landing without
        // spamming the console.
        const age = Date.now() - firstFrameAtRef.current;
        if (age % 3000 < 60) {
          console.log(
            "[bubble] frame received path=",
            dataUrl ? "dataUrl" : "bytes",
          );
        }
      }

      // Fast path — data URL. WebKit decodes <img> off the main
      // thread and drawImage is a cheap GPU blit.
      if (dataUrl) {
        latestPending = { dataUrl, w, h };
        dispatchPending();
        return;
      }

      // Legacy fallback — bytes array. Kept so that a stale popover
      // build can still drive this bubble. Can be removed once every
      // shipping build of the popover emits dataUrl.
      if (!bytes || !bytes.length) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
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
    }).then((u) => unlistens.push(u));

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

  // ---- explicit drag handler --------------------------------------------
  // We bypass `data-tauri-drag-region` entirely — it was unreliable across
  // three iterations (see PR history). Tauri's attribute hook watches for
  // elements with the attribute at page-load time, and also has gotchas
  // with pointer-events, unfocused-window first-click swallowing, and
  // WKWebView's latched event target. Calling `startDragging()` explicitly
  // on mousedown is the canonical robust path (per Tauri's own docs for
  // "customize drag behavior") and skips all of those footguns.
  //
  // Interactive children (close X, size dots) are marked `data-no-drag`
  // so their clicks land on their onClick handlers instead of starting
  // a window drag.
  const handleBubbleMouseDown = (e: React.MouseEvent) => {
    // Only left mouse button initiates drag.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Walk up from the target — any ancestor marked `data-no-drag`
    // means we're over a real control, not the draggable surface.
    if (target.closest("[data-no-drag]")) return;
    console.log("[bubble] startDragging");
    getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[bubble] startDragging failed", err);
      });
  };

  return (
    // The ENTIRE wrapper catches mousedown and calls `startDragging()`
    // directly. No `data-tauri-drag-region` — see `handleBubbleMouseDown`.
    <div
      className={`bubble-wrapper bubble-${size}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleBubbleMouseDown}
    >
      <div className="bubble-root">
        {/*
         * <canvas> has `pointer-events: none` in CSS so mousedown falls
         * through to the drag-handler wrapper.
         */}
        <canvas ref={canvasRef} className="bubble-video" />
        {/* Close X — top-right of bubble, only visible on hover. Marked
            `data-no-drag` so mousedown here does NOT call startDragging;
            onClick fires normally. */}
        <button
          type="button"
          className={`bubble-close ${showControls ? "is-visible" : ""}`}
          onClick={onClose}
          aria-label="Close camera"
          title="Close camera"
          data-no-drag
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
      {/* Size control pill — fades in under the bubble on hover. Marked
          `data-no-drag` so clicks land on the onClick handlers. */}
      <div
        className={`bubble-controls ${showControls ? "is-visible" : ""}`}
        data-no-drag
      >
        <button
          type="button"
          className={`bubble-dot bubble-dot-small ${size === "small" ? "is-active" : ""}`}
          onClick={() => pickSize("small")}
          aria-label="Small camera"
          title="Small"
          data-no-drag
        />
        <button
          type="button"
          className={`bubble-dot bubble-dot-medium ${size === "medium" ? "is-active" : ""}`}
          onClick={() => pickSize("medium")}
          aria-label="Medium camera"
          title="Medium"
          data-no-drag
        />
      </div>
    </div>
  );
}
