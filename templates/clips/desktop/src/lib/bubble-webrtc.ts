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

const BUBBLE_START_BITRATE_KBPS = 2500;
const BUBBLE_MIN_BITRATE_KBPS = 1200;
const BUBBLE_MAX_BITRATE_KBPS = 5000;

async function configureBubbleSender(
  sender: RTCRtpSender | null,
): Promise<void> {
  if (!sender) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = BUBBLE_MAX_BITRATE_KBPS * 1000;
    params.encodings[0].maxFramerate = 30;
    (params.encodings[0] as { minBitrate?: number }).minBitrate =
      BUBBLE_MIN_BITRATE_KBPS * 1000;
    params.degradationPreference = "maintain-resolution";
    await sender.setParameters(params);
  } catch (err) {
    console.warn("[clips-bubble-webrtc] setParameters failed", err);
  }
}

function boostBubbleVideoBitrate(sdp: string | undefined): string {
  if (!sdp) return sdp ?? "";
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r\n|\n/);
  const out: string[] = [];
  let inVideo = false;
  for (const line of lines) {
    if (line.startsWith("m=")) {
      inVideo = line.startsWith("m=video");
      out.push(line);
      continue;
    }
    if (inVideo && line.startsWith("c=")) {
      out.push(line);
      out.push(`b=AS:${BUBBLE_MAX_BITRATE_KBPS}`);
      out.push(`b=TIAS:${BUBBLE_MAX_BITRATE_KBPS * 1000}`);
      continue;
    }
    if (
      inVideo &&
      line.startsWith("a=fmtp:") &&
      !line.includes("apt=") &&
      !line.includes("x-google-start-bitrate")
    ) {
      out.push(
        `${line};x-google-start-bitrate=${BUBBLE_START_BITRATE_KBPS}` +
          `;x-google-min-bitrate=${BUBBLE_MIN_BITRATE_KBPS}` +
          `;x-google-max-bitrate=${BUBBLE_MAX_BITRATE_KBPS}`,
      );
      continue;
    }
    out.push(line);
  }
  return out.join(eol);
}

export interface BubbleWebrtcHandle {
  stop(): void;
}

export interface StartBubbleWebrtcParams {
  stream: MediaStream;
  onFailure: (reason: string) => void;
  onConnected?: () => void;
}

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
  let handshakeId = 0;

  function cleanupPeer() {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    if (pc) {
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
    unlistens.length = 0;
    console.log("[clips-bubble-webrtc] stopped");
  }

  async function startHandshake(): Promise<void> {
    handshakeId += 1;
    const myId = handshakeId;
    cleanupPeer();
    connected = false;

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
        onFailure(`ice-${state}`);
        stop();
      }
    };

    try {
      videoTrack.contentHint = "detail";
    } catch {
      // contentHint is a harmless no-op on older WebViews.
    }

    let sender: RTCRtpSender | null = null;
    try {
      sender = localPc.addTrack(videoTrack, stream);
    } catch (err) {
      console.warn("[clips-bubble-webrtc] addTrack failed:", err);
      onFailure("add-track-failed");
      stop();
      return;
    }

    let offer: RTCSessionDescriptionInit;
    try {
      offer = await localPc.createOffer();
      offer = { ...offer, sdp: boostBubbleVideoBitrate(offer.sdp) };
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

    await configureBubbleSender(sender);
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

    connectTimer = setTimeout(() => {
      if (stopped || myId !== handshakeId) return;
      if (connected) return;
      console.warn("[clips-bubble-webrtc] connect timeout");
      onFailure("connect-timeout");
      stop();
    }, CONNECT_TIMEOUT_MS);
  }

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
        console.warn("[clips-bubble-webrtc] addIceCandidate failed", err);
      }
    }),
  );

  emit("clips:bubble-handshake-request", {}).catch(() => {});

  return { stop };
}
