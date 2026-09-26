import { IconCameraOff } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import {
  BUBBLE_PLAY_HEARTBEAT_MS,
  BUBBLE_RENDER_GRACE_MS,
  shouldClaimWebrtcPath,
  shouldReportUnrendered,
} from "../lib/bubble-playback";

type BubbleSize = "small" | "medium";

export function Bubble() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstFrameAtRef = useRef<number | null>(null);
  const firstTrackAtRef = useRef<number | null>(null);
  const trackArrivedAtRef = useRef<number | null>(null);
  const attemptPlayRef = useRef<() => void>(() => {});
  const fallbackRequestedRef = useRef(false);
  const [activePath, setActivePath] = useState<"none" | "webrtc" | "canvas">(
    "none",
  );
  const [size, setSize] = useState<BubbleSize>("small");
  const [showControls, setShowControls] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("load_bubble_size")
      .then((value) => {
        if (cancelled) return;
        setSize(value === "medium" ? "medium" : "small");
      })
      .catch((err) => {
        console.warn("[bubble] load_bubble_size failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setShowControls(true);
  };
  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
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

  const pickSize = async (next: BubbleSize) => {
    if (next === size) return;
    try {
      await invoke("set_bubble_size", { size: next });
      setSize(next);
    } catch (err) {
      console.warn("[bubble] set_bubble_size failed", err);
    }
  };

  const onClose = async () => {
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let lastFailure: string | null = null;

    const attemptPlay = () => {
      if (stopped) return;
      if (!video.srcObject || !video.paused) return;
      video.play().catch((err: unknown) => {
        const name = (err as { name?: string } | null)?.name ?? "unknown";
        const message =
          (err as { message?: string } | null)?.message ?? String(err);
        const signature = `${name}: ${message}`;
        if (lastFailure === signature) return;
        lastFailure = signature;
        console.warn("[bubble] video.play() rejected —", signature);
      });
    };
    attemptPlayRef.current = attemptPlay;

    const maybeClaimWebrtcPath = () => {
      const claims = shouldClaimWebrtcPath({
        fallbackRequested: fallbackRequestedRef.current,
        videoWidth: video.videoWidth,
      });
      if (!claims) return;
      setActivePath((current) => {
        if (current !== "webrtc") {
          console.log(
            "[bubble] webrtc playback started %dx%d",
            video.videoWidth,
            video.videoHeight,
          );
        }
        return "webrtc";
      });
    };

    const onPlaying = () => {
      if (stopped) return;
      lastFailure = null;
      maybeClaimWebrtcPath();
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("loadedmetadata", attemptPlay);
    video.addEventListener("canplay", attemptPlay);
    video.addEventListener("pause", attemptPlay);
    document.addEventListener("visibilitychange", attemptPlay);

    const heartbeat = setInterval(() => {
      if (stopped) return;
      attemptPlay();
      maybeClaimWebrtcPath();
      const unrendered = shouldReportUnrendered({
        trackArrivedAt: trackArrivedAtRef.current,
        now: Date.now(),
        paused: video.paused,
        videoWidth: video.videoWidth,
        alreadyReported: fallbackRequestedRef.current,
      });
      if (!unrendered) return;
      fallbackRequestedRef.current = true;
      console.warn(
        "[bubble] webrtc track is not rendering after %dms (paused=%o readyState=%d videoWidth=%d) — asking popover for the canvas pump",
        BUBBLE_RENDER_GRACE_MS,
        video.paused,
        video.readyState,
        video.videoWidth,
      );
      emit("clips:bubble-webrtc-unrendered", {
        paused: video.paused,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        lastPlayFailure: lastFailure,
      }).catch(() => {});
    }, BUBBLE_PLAY_HEARTBEAT_MS);

    return () => {
      stopped = true;
      clearInterval(heartbeat);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("loadedmetadata", attemptPlay);
      video.removeEventListener("canplay", attemptPlay);
      video.removeEventListener("pause", attemptPlay);
      document.removeEventListener("visibilitychange", attemptPlay);
      attemptPlayRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    let pc: RTCPeerConnection | null = null;
    // Tracks the handshake id the popover stamped on the most recent
    // offer we processed. ICE candidates arriving for a stale id are
    // ignored (the popover sometimes re-negotiates if it reboots).
    let currentHandshakeId: number | null = null;
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
      trackArrivedAtRef.current = null;
      if (pc) {
        const videoEl = videoRef.current;
        if (videoEl && videoEl.srcObject) {
          try {
            videoEl.pause();
          } catch {
            // ignore
          }
          videoEl.srcObject = null;
        }
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
      teardownPeer();
      currentHandshakeId = incomingId;

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
        trackArrivedAtRef.current = Date.now();
        fallbackRequestedRef.current = false;
        attemptPlayRef.current();
        if (firstTrackAtRef.current == null) {
          firstTrackAtRef.current = Date.now();
          console.log("[bubble] first webrtc track received");
        }
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

    trackListen(
      listen("clips:bubble-handshake-request", () => {
        if (stopped) return;
        emit("clips:bubble-ready", {}).catch(() => {});
      }),
    );

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

        setActivePath("canvas");

        if (dataUrl) {
          latestPending = { dataUrl, w, h };
          dispatchPending();
          return;
        }

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

  const draggingRef = useRef(false);
  const moveFrameRef = useRef<number | null>(null);

  const handleBubblePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    e.preventDefault();
    draggingRef.current = true;
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
          style={activePath === "webrtc" ? { display: "none" } : undefined}
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
      {/* Size control pill — fades in above the bubble on hover. Marked
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
