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
 * streams video to this overlay. Two transport paths are supported:
 *
 *   1. **WebRTC loopback (preferred)** — the popover runs an
 *      `RTCPeerConnection`, adds the camera video track, creates an
 *      offer, and shuttles SDP + ICE through Tauri events. This
 *      bubble creates a receiving `RTCPeerConnection`, gets the
 *      track via `ontrack`, and plays it in a `<video>` element.
 *      Zero main-thread encode cost. Hardware-accelerated decode.
 *      See `bubble-webrtc.ts` for the full protocol.
 *
 *   2. **Canvas frame stream (fallback)** — legacy path. The popover
 *      runs `bubble-pump.ts`, encodes each frame as a JPEG data-URL,
 *      and emits `clips:bubble-frame`. This bubble decodes each
 *      payload via an `<img>` and blits onto a canvas. Kept so the
 *      feature degrades gracefully if the WebRTC handshake fails.
 *
 * The bubble always sets up BOTH receivers on mount. Whichever path
 * delivers video first wins — the other stays passive. If the
 * popover's WebRTC handshake fails (ICE timeout / failed state), it
 * stops trying and the popover starts the canvas pump instead, at
 * which point the canvas path takes over seamlessly.
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
  // Dual-path rendering: <video> for WebRTC, <canvas> for the legacy
  // JPEG stream. CSS stacks them in the same circle — whichever has a
  // stream / frames visible fills the same space. Starts with canvas
  // hidden via `data-path="webrtc"` on the root; once a WebRTC track
  // arrives we set it to "webrtc", and if WebRTC fails and canvas
  // frames start arriving we flip to "canvas".
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstFrameAtRef = useRef<number | null>(null);
  // Which transport delivered the most recent usable frame. Starts as
  // "none" — we flip to "webrtc" on ontrack, or "canvas" on the first
  // JPEG frame, whichever lands first.
  const [activePath, setActivePath] = useState<"none" | "webrtc" | "canvas">(
    "none",
  );
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

  // ---- WebRTC receiver ----------------------------------------------------
  // Sets up a fresh RTCPeerConnection on mount, emits `bubble-ready`
  // so the popover knows to start the handshake, and renegotiates on
  // every fresh offer. Fully self-contained — survives popover
  // restarts, stream swaps, and size changes.
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    let pc: RTCPeerConnection | null = null;
    // Tracks the handshake id the popover stamped on the most recent
    // offer we processed. ICE candidates arriving for a stale id are
    // ignored (the popover sometimes re-negotiates if it reboots).
    let currentHandshakeId: number | null = null;

    function teardownPeer() {
      if (pc) {
        try {
          pc.close();
        } catch {
          // ignore
        }
        pc = null;
      }
    }

    async function handleOffer(
      incomingId: number,
      sdp: string,
      type: string,
    ): Promise<void> {
      if (stopped) return;
      // Always restart on a new offer — the popover rebuilds its peer
      // on every bubble re-mount, so we do too.
      teardownPeer();
      currentHandshakeId = incomingId;

      // Same config as the sender — empty iceServers, all transports
      // allowed (see bubble-webrtc.ts). Receiver doesn't need to call
      // getUserMedia; WebKit's host-candidate restriction only means
      // WE don't expose host candidates, but we connect to the
      // sender's host candidate, which is all we need.
      const localPc = new RTCPeerConnection({
        iceServers: [],
        iceTransportPolicy: "all",
      });
      pc = localPc;

      localPc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        if (stopped || currentHandshakeId !== incomingId) return;
        emit("clips:webrtc-ice-from-bubble", {
          handshakeId: incomingId,
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        }).catch(() => {});
      };

      localPc.oniceconnectionstatechange = () => {
        if (stopped) return;
        console.log(
          "[bubble] ice state =",
          localPc.iceConnectionState,
          "signal =",
          localPc.signalingState,
        );
      };

      localPc.ontrack = (ev) => {
        if (stopped) return;
        const videoEl = videoRef.current;
        if (!videoEl) return;
        const incomingStream = ev.streams[0];
        if (!incomingStream) return;
        videoEl.srcObject = incomingStream;
        videoEl.play().catch((err) => {
          // Autoplay might be blocked in some WebKit corners —
          // `muted` + `playsInline` in JSX should be enough, but log
          // if it trips so we know to investigate.
          console.warn("[bubble] video.play() rejected", err);
        });
        if (firstFrameAtRef.current == null) {
          firstFrameAtRef.current = Date.now();
          console.log("[bubble] first webrtc track received");
        }
        setActivePath("webrtc");
      };

      try {
        await localPc.setRemoteDescription({ type: type as RTCSdpType, sdp });
      } catch (err) {
        console.warn("[bubble] setRemoteDescription(offer) failed", err);
        teardownPeer();
        return;
      }
      if (stopped || currentHandshakeId !== incomingId) return;
      let answer: RTCSessionDescriptionInit;
      try {
        answer = await localPc.createAnswer();
        await localPc.setLocalDescription(answer);
      } catch (err) {
        console.warn("[bubble] createAnswer / setLocalDescription failed", err);
        teardownPeer();
        return;
      }
      if (stopped || currentHandshakeId !== incomingId) return;
      try {
        await emit("clips:webrtc-answer", {
          handshakeId: incomingId,
          sdp: localPc.localDescription?.sdp ?? answer.sdp,
          type: "answer",
        });
      } catch (err) {
        console.warn("[bubble] emit answer failed", err);
      }
    }

    listen<{
      handshakeId: number;
      sdp: string;
      type: string;
    }>("clips:webrtc-offer", (ev) => {
      const { handshakeId, sdp, type } = ev.payload;
      handleOffer(handshakeId, sdp, type).catch((err) => {
        console.warn("[bubble] handleOffer threw", err);
      });
    })
      .then((u) => unlistens.push(u))
      .catch((err) => {
        console.warn("[bubble] listen offer failed", err);
      });

    listen<{
      handshakeId: number;
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    }>("clips:webrtc-ice-from-popover", async (ev) => {
      if (stopped) return;
      const {
        handshakeId: incomingId,
        candidate,
        sdpMid,
        sdpMLineIndex,
      } = ev.payload;
      if (incomingId !== currentHandshakeId) return;
      if (!pc) return;
      try {
        await pc.addIceCandidate({
          candidate,
          sdpMid: sdpMid ?? undefined,
          sdpMLineIndex: sdpMLineIndex ?? undefined,
        });
      } catch (err) {
        console.warn("[bubble] addIceCandidate failed", err);
      }
    })
      .then((u) => unlistens.push(u))
      .catch((err) => {
        console.warn("[bubble] listen ice failed", err);
      });

    // The popover may ping us if it thinks we missed the first
    // bubble-ready emit (e.g. popover restart with an already-mounted
    // bubble). Re-emit on demand.
    listen("clips:bubble-handshake-request", () => {
      if (stopped) return;
      emit("clips:bubble-ready", {}).catch(() => {});
    })
      .then((u) => unlistens.push(u))
      .catch(() => {});

    // Announce readiness once the listeners are all wired.
    emit("clips:bubble-ready", {}).catch((err) => {
      console.warn("[bubble] emit bubble-ready failed", err);
    });

    return () => {
      stopped = true;
      teardownPeer();
      unlistens.forEach((u) => u());
    };
  }, []);

  // ---- canvas fallback sink ----------------------------------------------
  // Legacy path — the popover's canvas pump emits JPEG data URLs. Only
  // drives display when WebRTC hasn't taken over (activePath != webrtc).
  // Kept so a popover that falls back to the canvas pump (or a stale
  // build) still drives the bubble.
  useEffect(() => {
    const unlistens: Array<() => void> = [];

    // Two-slot `<img>` pool — see the extensive rationale comment below.
    // Same pattern as the old implementation.
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
      }

      // Flip the active path on first canvas frame — only if WebRTC
      // hasn't already taken over. If WebRTC is live the canvas frames
      // still arrive (the popover may send a few overlap frames during
      // handover) but we ignore them for display.
      setActivePath((prev) => (prev === "webrtc" ? prev : "canvas"));

      if (dataUrl) {
        latestPending = { dataUrl, w, h };
        dispatchPending();
        return;
      }

      // Legacy fallback — bytes array. Kept so that a stale popover
      // build can still drive this bubble.
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
    // from older code paths don't blow up.
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
      data-path={activePath}
    >
      <div className="bubble-root">
        {/*
         * <video> is the WebRTC receiver. <canvas> is the legacy JPEG
         * sink. They're stacked in the same circle; whichever has a
         * live source dominates visually. Both have `pointer-events:
         * none` (bubble-video class) so mousedown falls through to the
         * wrapper's drag handler.
         *
         * `autoPlay playsInline muted` matches what the srcObject
         * requires for WebKit to start playing without a user gesture
         * (the video track arrives via WebRTC, not from autoplay
         * policy's perspective a "navigated" media resource, but muted
         * + inline is the safe combination).
         */}
        <video
          ref={videoRef}
          className="bubble-video"
          autoPlay
          playsInline
          muted
          style={activePath === "canvas" ? { display: "none" } : undefined}
        />
        <canvas
          ref={canvasRef}
          className="bubble-video"
          style={
            activePath === "webrtc"
              ? { display: "none" }
              : // Canvas stays visible during the "none" state so we show
                // a (black) circle rather than blank while handshake runs.
                undefined
          }
        />
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
