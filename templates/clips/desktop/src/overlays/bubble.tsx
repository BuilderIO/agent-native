import { IconCameraOff } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
type BubbleSize = "small" | "medium";

/**
 * Draggable, circular camera bubble — a PURE RENDERER.
 *
 * # Why we usually don't call getUserMedia here
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
 * The robust fix for browser/window capture is architectural: the POPOVER
 * owns the camera (it also owns the display-capture session, so "same page"
 * applies), and streams video to this overlay. Two transport paths are
 * supported:
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
    // Same race-safe listen tracker as in app.tsx. Every `listen()` is
    // an async IPC call; if this effect cleans up before the promise
    // resolves, the fire-and-forget `.then(push)` pattern leaks the
    // listener (and its entire closure scope, including pc + senders).
    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {
        // ignore — listen() itself may reject if the webview is dying
      });
    };

    function teardownPeer() {
      if (pc) {
        // Detach the incoming video <video>.srcObject BEFORE closing the
        // peer — otherwise WKWebView's media pipeline keeps the decoder
        // alive referencing the (now-dead) track. This is how a single
        // 1080p receiver peer can pin ~100 MB of GPU + decoder state
        // that GC can't reclaim.
        const videoEl = videoRef.current;
        if (videoEl && videoEl.srcObject) {
          try {
            videoEl.pause();
          } catch {
            // ignore
          }
          videoEl.srcObject = null;
        }
        // Null handlers so the closure graph doesn't keep the old peer
        // reachable through React state refs.
        try {
          pc.onicecandidate = null;
          pc.oniceconnectionstatechange = null;
          pc.ontrack = null;
        } catch {
          // ignore
        }
        const senders = pc.getSenders ? pc.getSenders() : [];
        console.log("[bubble] teardownPeer — senders:", senders.length);
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

    trackListen(
      listen<{
        handshakeId: number;
        sdp: string;
        type: string;
      }>("clips:webrtc-offer", (ev) => {
        const { handshakeId, sdp, type } = ev.payload;
        handleOffer(handshakeId, sdp, type).catch((err) => {
          console.warn("[bubble] handleOffer threw", err);
        });
      }),
    );

    trackListen(
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
      }),
    );

    // The popover may ping us if it thinks we missed the first
    // bubble-ready emit (e.g. popover restart with an already-mounted
    // bubble). Re-emit on demand.
    trackListen(
      listen("clips:bubble-handshake-request", () => {
        if (stopped) return;
        emit("clips:bubble-ready", {}).catch(() => {});
      }),
    );

    // Announce readiness once the listeners are all wired.
    emit("clips:bubble-ready", {}).catch((err) => {
      console.warn("[bubble] emit bubble-ready failed", err);
    });

    return () => {
      stopped = true;
      teardownPeer();
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
  }, []);

  // ---- canvas fallback sink ----------------------------------------------
  // Legacy path — the popover's canvas pump emits JPEG data URLs. Only
  // drives display when WebRTC hasn't taken over (activePath != webrtc).
  // Kept so a popover that falls back to the canvas pump (or a stale
  // build) still drives the bubble.
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {
        // ignore
      });
    };

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

    trackListen(
      listen<{
        dataUrl?: string;
        bytes?: number[];
        w: number;
        h: number;
      }>("clips:bubble-frame", async (ev) => {
        if (stopped) return;
        const { dataUrl, bytes, w, h } = ev.payload;

        if (firstFrameAtRef.current == null) {
          firstFrameAtRef.current = Date.now();
          console.log(
            "[bubble] first frame received path=",
            dataUrl ? "dataUrl" : "bytes",
          );
        }

        // During full-screen recording WebRTC can remain "connected" while
        // WebKit stops advancing frames. The popover starts the canvas pump
        // explicitly for that phase, so any canvas frame is a better display
        // source than a stale WebRTC frame.
        setActivePath("canvas");

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
      }),
    );

    // Keep `clips:bubble-config` as a no-op legacy listener so emits
    // from older code paths don't blow up.
    trackListen(
      listen("clips:bubble-config", (ev) => {
        console.log("[bubble] bubble-config (legacy, ignored)", ev.payload);
      }),
    );

    return () => {
      stopped = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
      // Drop pending frame reference + clear each slot's image so the
      // data URL string + decoded bitmap are GC'able. In normal operation
      // the Bubble window is destroyed on `hide_overlays`, but if the
      // component ever re-mounts we don't want to leak the previous
      // slot's dataUrl.
      latestPending = null;
      for (const slot of slots) {
        try {
          slot.img.src = "";
          slot.img.onload = null;
          slot.img.onerror = null;
        } catch {
          // ignore
        }
        slot.busy = false;
      }
    };
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
  // Loom-style manual drag. We deliberately do NOT use Tauri's native
  // `startDragging()` (or `data-tauri-drag-region`): with a native drag the OS
  // window server owns the position, so the only way to keep the bubble on
  // screen is to clamp AFTER each move and `set_position` it back — and the OS
  // immediately shoves it back out toward the cursor on the next frame. That
  // fight is exactly the jitter/snap-back we're killing here.
  //
  // Instead we drive the move ourselves. On pointer-down Rust snapshots the
  // cursor + window anchor; each frame `bubble_drag_move` reads the live cursor,
  // offsets the window by the cursor delta, and clamps BEFORE moving. The
  // window therefore stops dead at the edge like a puck against a wall — the
  // cursor keeps going, the bubble stays pinned, nothing to snap back from.
  //
  // Interactive children (close X, size dots) are marked `data-no-drag` so
  // their clicks land on their onClick handlers instead of starting a drag.
  const draggingRef = useRef(false);
  const moveFrameRef = useRef<number | null>(null);

  const handleBubblePointerDown = (e: React.PointerEvent) => {
    // Only the left button initiates a drag.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Any ancestor marked `data-no-drag` means we're over a real control.
    if (target.closest("[data-no-drag]")) return;
    e.preventDefault();
    draggingRef.current = true;
    // Pointer capture keeps pointermove/up flowing even after the cursor
    // leaves the (small) bubble window — which it will the moment the bubble
    // hits an edge and the cursor outruns it.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
    void invoke("bubble_drag_start").catch((err) => {
      console.warn("[bubble] bubble_drag_start failed", err);
    });
  };

  const handleBubblePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    // Coalesce a burst of pointermove events into at most one reposition per
    // animation frame, no matter how fast the OS delivers them. Rust reads the
    // live cursor itself, so the frame callback needs no coordinates.
    if (moveFrameRef.current != null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      if (!draggingRef.current) return;
      void invoke("bubble_drag_move").catch(() => {
        // Transient failures (e.g. window mid-teardown) are non-fatal; the
        // next pointermove schedules another frame.
      });
    });
  };

  const endBubbleDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (moveFrameRef.current != null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    void invoke("bubble_drag_end").catch((err) => {
      console.warn("[bubble] bubble_drag_end failed", err);
    });
  };

  return (
    // The ENTIRE wrapper is the drag surface — pointer-down drives the manual
    // clamp-before-move drag loop. No `startDragging()`, no
    // `data-tauri-drag-region` — see `handleBubblePointerDown` above.
    <div
      className={`bubble-wrapper bubble-${size}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={handleBubblePointerDown}
      onPointerMove={handleBubblePointerMove}
      onPointerUp={endBubbleDrag}
      onPointerCancel={endBubbleDrag}
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
            `data-no-drag` so pointer-down here does NOT start a drag;
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
          className="bubble-control-button"
          onClick={onClose}
          aria-label="Turn camera off"
          title="Turn camera off"
          data-no-drag
        >
          <IconCameraOff size={14} stroke={2} />
        </button>
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
