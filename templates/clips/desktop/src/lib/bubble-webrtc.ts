/**
 * WebRTC local loopback sender for the camera bubble overlay.
 *
 * Replaces the canvas-encode-and-emit pipeline in `bubble-pump.ts` with a
 * direct `RTCPeerConnection` hand-off. The popover holds the camera
 * `MediaStream` (because of WebKit's single-page capture-exclusion policy —
 * see the long comment in `recorder.ts`) and adds the video track to a
 * peer connection. The bubble window creates a receiving peer and gets
 * the track via `ontrack`. Signaling shuttles through Tauri events.
 *
 * Why this exists:
 *
 * - `canvas.toDataURL` on the main thread was ~30-40ms per frame on
 *   macOS WKWebView during recording. At any FPS higher than ~6 we
 *   dropped frames. Dropping to 6 FPS + 112px + JPEG q=0.45 made the
 *   bubble both choppy AND fuzzy.
 * - WebRTC goes through WebKit's native media pipeline. Video track →
 *   SDP negotiation → receiver gets a live track → `<video>` element
 *   renders via the GPU-backed decoder. Zero main-thread encode cost.
 * - ICE uses host candidates (127.0.0.1) for same-process loopback, no
 *   network round-trip.
 *
 * ## Web research findings
 *
 * WebKit restricts host ICE candidates to pages that have called
 * `getUserMedia` (security: candidates expose IPs). The popover has
 * already called `getUserMedia` to acquire the camera — so its offerer
 * peer connection WILL have host candidates, including 127.0.0.1. The
 * bubble-side receiver does not call `getUserMedia`, so it has no host
 * candidates of its own — but it doesn't need them: it connects TO the
 * popover's host candidate, which is enough for ICE to establish.
 *
 * References (April 2026):
 * - https://webkit.org/blog/7763/a-closer-look-into-webrtc/
 *   "Without access to capture devices, WebKit only exposes Server
 *   Reflexive and TURN ICE candidates [...]. When access is granted,
 *   WebKit will expose host ICE candidates."
 * - https://bugs.webkit.org/show_bug.cgi?id=183201 — WebRTC in WKWebView
 *   (Tauri v2's macOS webview is WKWebView, and this bug confirms
 *   RTCPeerConnection + RTCDataChannel are supported).
 * - https://groups.google.com/g/discuss-webrtc/c/iWxgIZacv9I — "WebRTC
 *   connection between peers connected on localhost 127.0.0.1" confirms
 *   the loopback pattern works with empty iceServers.
 *
 * Gotchas we plan for:
 * - `iceServers: []` + `iceTransportPolicy: "all"` to tell WebKit
 *   "don't bother STUN, host candidates are fine".
 * - Receiver might hit WebKit's "no host candidates without capture"
 *   policy. That's OK here — one side needs host candidates, not both.
 *   The sender (popover) has them.
 * - Handshake coordination — the bubble window mounts after the popover
 *   calls `show_bubble`. The bubble emits `clips:bubble-ready` once its
 *   receiver peer is set up. Only THEN do we create the offer.
 *
 * ## Events
 *
 * - `clips:bubble-ready`       bubble → popover : receiver is listening
 * - `clips:webrtc-offer`       popover → bubble : SDP offer
 * - `clips:webrtc-answer`      bubble → popover : SDP answer
 * - `clips:webrtc-ice-from-popover` popover → bubble : ICE candidate
 * - `clips:webrtc-ice-from-bubble`  bubble → popover : ICE candidate
 *
 * ## Fallback
 *
 * If the peer fails to reach `connected` state within
 * `CONNECT_TIMEOUT_MS`, or if `iceConnectionState` goes to `failed` at
 * any point, the start function rejects via its `onFailure` callback.
 * The caller (app.tsx) should then fall back to the canvas-encode pump.
 * This keeps the existing feature working even if WebKit tightens its
 * loopback rules in a future WebView version.
 */
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

const CONNECT_TIMEOUT_MS = 3000;

export interface BubbleWebrtcHandle {
  /** Tear down the peer connection and unsubscribe listeners. */
  stop(): void;
}

export interface StartBubbleWebrtcParams {
  /** Live camera stream owned by the popover. We borrow one video track. */
  stream: MediaStream;
  /**
   * Called if ICE fails to reach `connected` in time, or flips to
   * `failed` later. Caller should start the canvas fallback pump.
   */
  onFailure: (reason: string) => void;
  /**
   * Called once the peer connection reaches `connected`. Informational —
   * useful for logging / metrics.
   */
  onConnected?: () => void;
}

/**
 * Start a WebRTC sender for the bubble overlay.
 *
 * Coordination flow:
 *   1. Subscribe to `clips:bubble-ready` — bubble emits this when its
 *      receiver is ready to accept an offer. Bubble may re-emit on
 *      re-mount; we tear down the old peer and start fresh each time.
 *   2. On `bubble-ready`: create RTCPeerConnection, add the camera
 *      video track, createOffer, setLocalDescription, emit offer.
 *   3. On `clips:webrtc-answer`: setRemoteDescription.
 *   4. On `clips:webrtc-ice-from-bubble`: addIceCandidate.
 *   5. `pc.onicecandidate` → emit `clips:webrtc-ice-from-popover`.
 *   6. If `iceConnectionState` doesn't reach `connected`/`completed`
 *      within CONNECT_TIMEOUT_MS, call onFailure and tear down.
 */
export function startBubbleWebrtc(
  params: StartBubbleWebrtcParams,
): BubbleWebrtcHandle {
  const { stream, onFailure, onConnected } = params;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    onFailure("no-video-track");
    return { stop: () => {} };
  }

  let stopped = false;
  let pc: RTCPeerConnection | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  const unlistens: UnlistenFn[] = [];
  let connected = false;
  // The bubble emits `clips:bubble-ready` every time it (re)mounts.
  // Any stale peer connection we had must be torn down and rebuilt with
  // a new offer — otherwise the new receiver and our old peer talk past
  // each other forever.
  let handshakeId = 0;

  function cleanupPeer() {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    if (pc) {
      // Explicitly drop all senders before close so WebKit doesn't hold
      // onto encoder state for the (already-borrowed) video track. The
      // video track itself belongs to the popover's MediaStream — the
      // bubble-session effect in app.tsx stops it — so we must NOT stop
      // it here. Just detach from this peer.
      try {
        const senders = pc.getSenders ? pc.getSenders() : [];
        for (const s of senders) {
          try {
            pc.removeTrack(s);
          } catch {
            // ignore — some senders reject removeTrack after close
          }
        }
        console.log(
          "[clips-bubble-webrtc] cleanupPeer — senders:",
          senders.length,
        );
      } catch (err) {
        console.warn("[clips-bubble-webrtc] removeTrack failed", err);
      }
      // Null out the handlers so WebKit doesn't keep the closure alive
      // through a dangling event reference.
      try {
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.ontrack = null;
      } catch {
        // ignore
      }
      try {
        pc.close();
      } catch {
        // ignore — already closed
      }
      pc = null;
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cleanupPeer();
    for (const u of unlistens) {
      try {
        u();
      } catch {
        // ignore
      }
    }
    // Empty the array so we don't retain listener closures if something
    // holds a stale reference to this handle after stop().
    unlistens.length = 0;
    console.log("[clips-bubble-webrtc] stopped");
  }

  async function startHandshake(): Promise<void> {
    // Each handshake gets a fresh id. If the bubble re-emits
    // bubble-ready while we're mid-handshake, we bump the id, tear
    // down, and start over — old answers / ICE for the previous id
    // are ignored.
    handshakeId += 1;
    const myId = handshakeId;
    cleanupPeer();
    connected = false;

    // `iceServers: []` + `iceTransportPolicy: "all"` — we're connecting
    // over loopback. No STUN/TURN needed, and explicitly empty saves
    // WebKit from a pointless "resolve server" round-trip on startup.
    const localPc = new RTCPeerConnection({
      iceServers: [],
      iceTransportPolicy: "all",
    });
    pc = localPc;

    localPc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      if (stopped || myId !== handshakeId) return;
      emit("clips:webrtc-ice-from-popover", {
        handshakeId: myId,
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex,
      }).catch(() => {});
    };

    localPc.oniceconnectionstatechange = () => {
      if (stopped || myId !== handshakeId) return;
      const state = localPc.iceConnectionState;
      console.log("[clips-bubble-webrtc] iceConnectionState =", state);
      if (state === "connected" || state === "completed") {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        if (!connected) {
          connected = true;
          onConnected?.();
        }
      } else if (state === "failed" || state === "disconnected") {
        // `disconnected` can be transient on a flaky network, but on
        // loopback there IS no network — a disconnect means something
        // actually broke. Treat as failure for fallback purposes.
        onFailure(`ice-${state}`);
        stop();
      }
    };

    // Add the camera video track. WebRTC will renegotiate if the track
    // id changes, but we only add once per handshake so this is a
    // one-shot.
    try {
      localPc.addTrack(videoTrack, stream);
    } catch (err) {
      console.warn("[clips-bubble-webrtc] addTrack failed:", err);
      onFailure("add-track-failed");
      stop();
      return;
    }

    let offer: RTCSessionDescriptionInit;
    try {
      offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
    } catch (err) {
      console.warn(
        "[clips-bubble-webrtc] offer/setLocalDescription failed",
        err,
      );
      onFailure("offer-failed");
      stop();
      return;
    }
    if (stopped || myId !== handshakeId) return;

    try {
      await emit("clips:webrtc-offer", {
        handshakeId: myId,
        sdp: localPc.localDescription?.sdp ?? offer.sdp,
        type: "offer",
      });
    } catch (err) {
      console.warn("[clips-bubble-webrtc] emit offer failed", err);
      onFailure("emit-offer-failed");
      stop();
      return;
    }

    // Fail-closed timer. If ICE hasn't connected in CONNECT_TIMEOUT_MS,
    // let the caller fall back to the canvas pump. Cleared when we
    // reach `connected`.
    connectTimer = setTimeout(() => {
      if (stopped || myId !== handshakeId) return;
      if (connected) return;
      console.warn("[clips-bubble-webrtc] connect timeout");
      onFailure("connect-timeout");
      stop();
    }, CONNECT_TIMEOUT_MS);
  }

  // -- wire up listeners --------------------------------------------------
  //
  // Race-safe listen tracking. `listen()` is async and returns a Promise
  // that resolves to the unlisten fn. If `stop()` is called between the
  // listen() call and its resolution (e.g. a fast preview→record→cancel
  // cycle), the fire-and-forget `.then(push)` pattern would never enqueue
  // the unlisten — the listener would live on for the lifetime of the
  // webview, with its closure pinning the peer connection + ICE state.
  // Instead: if `stopped` is already true when the promise resolves, call
  // the unlisten immediately.
  const trackListen = (p: Promise<UnlistenFn>): void => {
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
    }).catch((err) => {
      console.warn("[clips-bubble-webrtc] listen failed", err);
    });
  };

  trackListen(
    listen<{ handshakeId?: number }>("clips:bubble-ready", (ev) => {
      if (stopped) return;
      // If the bubble re-mounts (it emits bubble-ready on every mount),
      // restart the handshake from scratch.
      console.log(
        "[clips-bubble-webrtc] bubble-ready received — starting handshake",
        ev.payload,
      );
      startHandshake().catch((err) => {
        console.warn("[clips-bubble-webrtc] startHandshake threw", err);
      });
    }),
  );

  trackListen(
    listen<{ handshakeId: number; sdp: string; type: string }>(
      "clips:webrtc-answer",
      async (ev) => {
        if (stopped) return;
        const { handshakeId: incomingId, sdp, type } = ev.payload;
        if (incomingId !== handshakeId) {
          console.log(
            "[clips-bubble-webrtc] answer for stale handshake — ignoring",
            incomingId,
            handshakeId,
          );
          return;
        }
        if (!pc) return;
        try {
          await pc.setRemoteDescription({ type: type as RTCSdpType, sdp });
          console.log("[clips-bubble-webrtc] setRemoteDescription(answer) ok");
        } catch (err) {
          console.warn(
            "[clips-bubble-webrtc] setRemoteDescription failed",
            err,
          );
          onFailure("set-remote-failed");
          stop();
        }
      },
    ),
  );

  trackListen(
    listen<{
      handshakeId: number;
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    }>("clips:webrtc-ice-from-bubble", async (ev) => {
      if (stopped) return;
      const {
        handshakeId: incomingId,
        candidate,
        sdpMid,
        sdpMLineIndex,
      } = ev.payload;
      if (incomingId !== handshakeId) return;
      if (!pc) return;
      try {
        await pc.addIceCandidate({
          candidate,
          sdpMid: sdpMid ?? undefined,
          sdpMLineIndex: sdpMLineIndex ?? undefined,
        });
      } catch (err) {
        // Some candidates fail to add (e.g. already-closed peer, stale
        // handshake). Not fatal — the surviving candidates can still form
        // a connection on loopback.
        console.warn("[clips-bubble-webrtc] addIceCandidate failed", err);
      }
    }),
  );

  // If the bubble window was already alive when we started (e.g. a
  // re-start of the session), it might not re-emit bubble-ready. Ping
  // for a fresh emit — the bubble responds by firing bubble-ready
  // again.
  emit("clips:bubble-handshake-request", {}).catch(() => {});

  return { stop };
}
