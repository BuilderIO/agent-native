import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startBubbleFramePump } from "./lib/bubble-pump";
import {
  startBubbleWebrtc,
  type BubbleWebrtcHandle,
} from "./lib/bubble-webrtc";
import { startNativeRecording, type RecorderHandle } from "./lib/recorder";
import {
  installDesktopVoiceDictation,
  type VoiceMode,
  type VoiceProvider,
  type VoiceShortcutPreference,
} from "./lib/voice-dictation";
import { UpdateBanner } from "./components/UpdateBanner";
import { useFeatureConfig } from "./shared/config";
import { IconArrowLeft, IconInfoCircle } from "@tabler/icons-react";

interface RecordingSummary {
  id: string;
  title: string;
  durationMs: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

type CaptureMode = "screen" | "screen-camera" | "camera";
type CaptureSource = "full-screen" | "window" | "tab" | "custom";

const STORAGE_KEY = "clips:server-url";
const MODE_KEY = "clips:last-mode";
const VOICE_SHORTCUT_KEY = "clips:voice-shortcut";
const VOICE_SHORTCUT_CONFIGURED_KEY = "clips:voice-shortcut-configured";
const VOICE_MODE_KEY = "clips:voice-mode";
const VOICE_PROVIDER_KEY = "clips:voice-provider";
const SOURCE_KEY = "clips:last-source";
const CAM_KEY = "clips:last-camera-id";
const MIC_KEY = "clips:last-mic-id";
const CAM_ON_KEY = "clips:camera-on";
const MIC_ON_KEY = "clips:mic-on";

// Sensible defaults so the user never has to type a URL on first launch.
// Dev builds point at the local dev server; production builds point at the
// hosted Clips instance. The user can still override from Settings.
// Dev points at the Clips dev server (shared-app-config says 8094).
// Prod points at the hosted Clips instance. User can override from Settings.
const DEFAULT_URL = import.meta.env.DEV
  ? "http://localhost:8094"
  : "https://clips.agent-native.com";

const MACOS_CAPTURE_PERMISSION_MESSAGE =
  "Recording permission is blocked. Open System Settings → Privacy & Security and enable Camera, Microphone, and Screen & System Audio Recording for Clips. In Tauri dev, macOS may list the debug binary separately from Ghostty or node, so restart Clips after granting it.";

function loadString(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    if (v && v.trim()) return v;
  } catch {
    // ignore
  }
  return fallback;
}

function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // non-fatal
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    // ignore
  }
  return fallback;
}

function saveBool(key: string, value: boolean): void {
  saveString(key, value ? "1" : "0");
}

function formatAgo(iso: string): string {
  try {
    const delta = (Date.now() - new Date(iso).getTime()) / 1000;
    if (delta < 60) return "just now";
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86400)}d ago`;
  } catch {
    return "";
  }
}

export function App() {
  const featureConfig = useFeatureConfig();
  const [serverUrl, setServerUrl] = useState<string>(() =>
    loadString(STORAGE_KEY, DEFAULT_URL).replace(/\/+$/, ""),
  );
  const [mode, setMode] = useState<CaptureMode>(
    () => loadString(MODE_KEY, "screen-camera") as CaptureMode,
  );
  const [source, setSource] = useState<CaptureSource>(
    () => loadString(SOURCE_KEY, "full-screen") as CaptureSource,
  );
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>(() =>
    loadString(CAM_KEY, ""),
  );
  const [micId, setMicId] = useState<string>(() => loadString(MIC_KEY, ""));
  const [cameraOn, setCameraOn] = useState<boolean>(() =>
    loadBool(CAM_ON_KEY, true),
  );
  const [micOn, setMicOn] = useState<boolean>(() => loadBool(MIC_ON_KEY, true));
  const [voiceShortcut, setVoiceShortcut] = useState<VoiceShortcutPreference>(
    () => {
      if (!loadBool(VOICE_SHORTCUT_CONFIGURED_KEY, false)) return "both";
      const saved = loadString(VOICE_SHORTCUT_KEY, "both");
      return saved === "fn" ||
        saved === "cmd-shift-space" ||
        saved === "ctrl-shift-space" ||
        saved === "both"
        ? saved
        : "both";
    },
  );
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => {
    const saved = loadString(VOICE_MODE_KEY, "push-to-talk");
    return saved === "toggle" ? "toggle" : "push-to-talk";
  });
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
    // Default: macOS gets the native path (SFSpeechRecognizer +
    // AVAudioEngine driven from Rust) — cleanly releases the mic on
    // stop, no "Polishing..." step, no API keys. WKWebView's
    // webkitSpeechRecognition keeps the orange mic indicator on after
    // abort, so we route Mac users away from it by default. Windows /
    // Linux fall back to the browser path until we add a native
    // equivalent there.
    const saved = loadString(
      VOICE_PROVIDER_KEY,
      isMac ? "macos-native" : "browser",
    );
    // `macos-native` calls into native_speech_start which only works on
    // macOS; on Windows/Linux a saved selection would be permanently
    // broken. Coerce back to "browser" if we're not on a Mac.
    if (saved === "macos-native" && !isMac) return "browser";
    return saved === "auto" ||
      saved === "browser" ||
      saved === "macos-native" ||
      saved === "builder" ||
      saved === "gemini" ||
      saved === "openai" ||
      saved === "groq"
      ? saved
      : isMac
        ? "macos-native"
        : "browser";
  });

  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [recorder, setRecorder] = useState<RecorderHandle | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Latched true the moment the user clicks Start Recording and cleared
  // when the recorder fully stops/cancels. We use this to suppress the
  // popover auto-hide during the macOS screen-picker focus dance.
  const [recordingFlowActive, setRecordingFlowActive] = useState(false);
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<"unknown" | "authed" | "anon">(
    "unknown",
  );
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signInPending, setSignInPending] = useState(false);
  // Ref-based lock so two fast clicks cannot both enter signInExternal()
  // (state updates are async; refs are synchronous).
  const signInInflightRef = useRef(false);
  // Stored so Cancel can stop the polling loop.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecording = recorder !== null;
  const updateVoiceShortcut = useCallback((value: VoiceShortcutPreference) => {
    saveBool(VOICE_SHORTCUT_CONFIGURED_KEY, true);
    setVoiceShortcut(value);
  }, []);

  useEffect(() => {
    return installDesktopVoiceDictation({
      enabled: featureConfig?.voiceEnabled !== false,
      serverUrl,
      shortcut: voiceShortcut,
      mode: voiceMode,
      provider: voiceProvider,
    });
  }, [
    featureConfig?.voiceEnabled,
    serverUrl,
    voiceShortcut,
    voiceMode,
    voiceProvider,
  ]);

  // ---- auth status --------------------------------------------------------
  // The Tauri WebView has its own cookie jar (separate from the user's
  // browser). Before anything else, check whether we have a session cookie
  // for the Clips server; if not, surface a Sign in button.
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/session`,
        { credentials: "include" },
      );
      if (!res.ok) {
        setAuthStatus("anon");
        setSignedInAs(null);
        return false;
      }
      const json = (await res.json().catch(() => null)) as {
        email?: string;
        error?: string;
      } | null;
      if (json?.email) {
        setAuthStatus("authed");
        setSignedInAs(json.email);
        return true;
      }
      setAuthStatus("anon");
      setSignedInAs(null);
      return false;
    } catch {
      setAuthStatus("anon");
      setSignedInAs(null);
      return false;
    }
  }, [serverUrl]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // OAuth (Google) opens in the system browser — the popover WebView can't
  // share a cookie jar with a separate Tauri WebviewWindow, and the old
  // approach of opening a WebView at the server root produced a blank window.
  // Instead: fetch the Google auth URL, open it externally, then poll a
  // server-side exchange endpoint for the session token.
  async function signInExternal() {
    // Synchronous ref guard — prevents a double-click from opening two OAuth
    // tabs. State updates are async so `signInPending` alone isn't sufficient.
    if (signInInflightRef.current) return;
    signInInflightRef.current = true;

    function stopPolling() {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    try {
      const flowId =
        crypto.randomUUID?.() ||
        Math.random().toString(36).slice(2) + Date.now().toString(36);
      const base = serverUrl.replace(/\/+$/, "");

      // Open directly in the system browser — the server redirects (302)
      // to Google's OAuth page, avoiding any cross-origin fetch from
      // the Tauri WebView.
      await openExternal(
        `${base}/_agent-native/google/auth-url?desktop=1&flow_id=${flowId}&redirect=1`,
      );

      setSignInPending(true);

      // Poll the exchange endpoint for the session token.
      const start = Date.now();
      const TIMEOUT_MS = 180_000; // 3 minutes
      pollIntervalRef.current = setInterval(async () => {
        try {
          const xr = await fetch(
            `${base}/_agent-native/auth/desktop-exchange?flow_id=${flowId}`,
          );
          if (!xr.ok) {
            if (Date.now() - start > TIMEOUT_MS) {
              stopPolling();
              signInInflightRef.current = false;
              setSignInPending(false);
            }
            return;
          }
          const xd = await xr.json();
          if (xd?.token) {
            stopPolling();
            // Establish the session cookie in the Tauri WebView's cookie jar.
            await fetch(
              `${base}/_agent-native/auth/session?_session=${xd.token}`,
              { credentials: "include" },
            );
            signInInflightRef.current = false;
            setSignInPending(false);
            await checkAuth();
          } else if (Date.now() - start > TIMEOUT_MS) {
            stopPolling();
            signInInflightRef.current = false;
            setSignInPending(false);
          }
        } catch {
          if (Date.now() - start > TIMEOUT_MS) {
            stopPolling();
            signInInflightRef.current = false;
            setSignInPending(false);
          }
        }
      }, 1500);
    } catch (err) {
      console.error("[clips-tray] signInExternal failed:", err);
      signInInflightRef.current = false;
      setSignInPending(false);
    }
  }

  // Sign out via the framework's logout endpoint. The cookie clears in the
  // same webview that will re-check `/auth/session`, so the popover flips
  // back to the inline sign-in form without a reload.
  async function signOut() {
    try {
      await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/logout`,
        { method: "POST", credentials: "include" },
      );
    } catch {
      // ignore — we'll re-check session regardless
    }
    await checkAuth();
    setShowSettings(false);
  }

  // ---- device enumeration -------------------------------------------------
  // WebKit only returns full device labels after getUserMedia() has granted
  // access once. So we do a one-shot mic + camera probe when the popover
  // first loads (if permissions are already granted, this is silent; if
  // not, the OS prompts once and we get the full list on the next render).
  const loadDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      setCameras(list.filter((d) => d.kind === "videoinput"));
      setMics(list.filter((d) => d.kind === "audioinput"));
    } catch {
      // ignore
    }
  }, []);

  const unlockDeviceLabels = useCallback(async () => {
    // Audio-only probe to unlock mic labels. We INTENTIONALLY skip video —
    // the on-screen camera bubble window owns the camera, and probing
    // video here would race for the hardware and knock the bubble's
    // stream offline (macOS can't reliably share a camera across two
    // WebViews in the same process). Camera-label text is low-value
    // anyway; most machines have one.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      // permission denied — labels stay empty until the user grants
    }
    await loadDevices();
  }, [loadDevices]);

  // ---- Esc closes the popover --------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Don't close mid-recording — user would lose the recorder handle.
        if (isRecording) return;
        hidePopover();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording]);

  // ---- popover visibility tracking ----------------------------------------
  // ONLY source of truth: explicit `clips:popover-visible` events from Rust,
  // which fire on every show/hide (including the blur-auto-hide path).
  // Focus events are NOT reliable here — opening devtools steals focus,
  // clicking inside the popover re-gains it, etc., which caused an
  // infinite show_bubble/hide flap when we listened to onFocusChanged.
  const [popoverVisible, setPopoverVisible] = useState(false);
  useEffect(() => {
    // Race-safe listen tracking. `listen()` is async — the unlisten fn
    // only exists AFTER the IPC round-trip resolves. If React cleanup
    // fires before that, the "fire-and-forget" `.then((u) => push(u))`
    // pattern never enqueues the unlisten and the listener leaks
    // forever. Each leaked listener closes over the effect scope +
    // React state, so every remount of this component grows heap.
    // Track `cancelled` and call the unlisten IMMEDIATELY if it arrives
    // after cleanup ran.
    let cancelled = false;
    const unlistens: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {
        // ignore — best-effort
      });
    };
    track(
      listen<boolean>("clips:popover-visible", (ev) => {
        console.log("[clips-popover] popover-visible =", ev.payload);
        setPopoverVisible(!!ev.payload);
      }),
    );
    // The bubble window emits `clips:bubble-closed` when the user clicks
    // the X on the hover controls. Treat that as "camera off" — the
    // bubble-session effect then tears down the stream + pump.
    track(
      listen("clips:bubble-closed", () => {
        console.log(
          "[clips-popover] bubble-closed received — clearing cameraOn",
        );
        setCameraOn(false);
      }),
    );
    // Query the CURRENT visibility on mount in case the event already
    // fired before React subscribed.
    getCurrentWindow()
      .isVisible()
      .then((v) => {
        if (cancelled) return;
        console.log("[clips-popover] initial isVisible =", v);
        setPopoverVisible(!!v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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

  // Defer device-label unlocking until the popover is first shown. The
  // getUserMedia({audio}) call triggers a macOS permission dialog — if it
  // fires on mount (before the popover is visible), the OS dialog appears
  // with no visible app context and can interfere with the tray icon and
  // subsequent popover shows.
  const deviceLabelsUnlocked = useRef(false);
  useEffect(() => {
    loadDevices();
    if (popoverVisible && !deviceLabelsUnlocked.current) {
      deviceLabelsUnlocked.current = true;
      unlockDeviceLabels();
    }
  }, [loadDevices, unlockDeviceLabels, popoverVisible]);

  // ---- camera bubble session ---------------------------------------------
  // The bubble overlay (small circular PiP in the bottom-left of the screen
  // showing the user's face) is owned by the popover for the ENTIRE camera
  // session — not just during recording. That's a hard requirement of
  // WebKit's single-page capture-exclusion policy (see `recorder.ts` and
  // `bubble-pump.ts` headers for the full story): if two webviews in the
  // same process try to hold capture hardware, WebKit silently mutes one
  // of them. The only webview that can reliably hold the camera is this
  // popover, so this popover is where the MediaStream lives and where the
  // frame pump runs.
  //
  // Lifecycle:
  //   - Popover visible + camera mode + cameraOn → acquire camera, call
  //     show_bubble, start frame pump. User sees their face in the
  //     bottom-left corner.
  //   - User clicks Start Recording → popover hides, recording begins.
  //     `isRecording` becomes true, so this effect's deps still say
  //     "active" — the stream + bubble + pump keep running. The recorder
  //     just borrows the video track for MediaRecorder (see
  //     `preAcquiredCameraStream` in recorder.ts).
  //   - Recording stops → `isRecording` flips back to false, popover
  //     usually hides too, so the effect cleans up: stop tracks, hide
  //     overlays (which closes the bubble window).
  //   - User switches camera / turns camera off / closes popover (not
  //     recording) → cleanup fires, bubble disappears.
  const bubbleStreamRef = useRef<MediaStream | null>(null);
  // Set to true the instant startRecording hands `bubbleStreamRef.current`
  // to `startNativeRecording` as `preAcquiredCameraStream`. The recorder
  // then owns the track lifecycle — this effect's cleanup MUST NOT stop
  // the tracks or the MediaRecorder ends up with `readyState: "ended"`
  // tracks (which causes the laggy / black / silently-failing recording
  // symptoms). Reset to false once the recording is fully torn down.
  const bubbleStreamTransferredToRecorder = useRef(false);
  const wantsCamera = mode !== "screen" && cameraOn;
  // Ref mirror of `isRecording || recordingFlowActive` so cleanup (which
  // captures the dep-snapshot value) can still see the CURRENT flow state
  // at the moment it actually runs. Without this, if `recordingFlowActive`
  // briefly flips false on a re-render mid-flow (e.g. finally-block
  // recovery path), the cleanup function snapshots `bubbleActive=false`
  // from THAT render and stops the camera stream even though recording is
  // still in flight.
  const recordingFlowGateRef = useRef(false);
  recordingFlowGateRef.current = isRecording || recordingFlowActive;
  const bubbleActive =
    wantsCamera && (popoverVisible || isRecording || recordingFlowActive);
  // The toolbar is recording chrome, not pre-record chrome. Showing it while
  // the popover is merely open leaves a disabled 0:00 Stop/Pause pill on the
  // desktop, which reads as a stuck recorder and can trap accessibility clicks.
  const toolbarActive = isRecording || recordingFlowActive;

  useEffect(() => {
    if (!toolbarActive) return;
    let cancelled = false;
    (async () => {
      try {
        await invoke("show_toolbar");
        if (cancelled) return;
        // Seed disabled — previous recordings may have latched it on in
        // the toolbar's React state (the window is destroyed on
        // `hide_overlays`, so this is mostly defensive, but free).
        emit("clips:toolbar-enabled", false).catch(() => {});
      } catch (err) {
        console.error("[clips-popover] show_toolbar failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      // In screen-only mode the bubble effect never runs, so its
      // cleanup (which normally hides overlays) never fires either.
      // Hide them from here instead. Guard on !recordingInFlight so
      // we don't rip the toolbar out from under an active recording.
      if (!recordingFlowGateRef.current) {
        invoke("hide_overlays").catch(() => {});
      }
    };
  }, [toolbarActive]);

  useEffect(() => {
    if (!bubbleActive) return;
    setCameraError(null);

    let cancelled = false;
    // Dual-transport bookkeeping. We try WebRTC first; if it fails or
    // times out, we fall back to the canvas pump. Only one should be
    // active at a time — the ref below guarantees we never double-start.
    let webrtcHandle: BubbleWebrtcHandle | null = null;
    let stopPump: (() => void) | null = null;
    let fellBackToPump = false;
    let stream: MediaStream | null = null;

    console.log(
      "[clips-popover] bubble session start — acquiring camera + showing bubble",
    );
    navigator.mediaDevices
      .getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) {
          // Effect re-ran before we resolved — throw this stream away.
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        bubbleStreamRef.current = s;
        // Open the bubble window. It's a pure renderer — the bubble
        // itself creates an RTCPeerConnection receiver and emits
        // `clips:bubble-ready` once it's listening. We also keep the
        // legacy canvas-frame sink around so a WebRTC failure can
        // fall back to JPEG frames without a bubble reload.
        try {
          await invoke("show_bubble");
        } catch (err) {
          console.error("[clips-popover] show_bubble failed:", err);
        }
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        // Preferred path: WebRTC. Starts listening for bubble-ready,
        // then kicks off an offer/answer/ICE dance. If ICE doesn't
        // connect within the timeout (or fails later) we start the
        // canvas pump in its place. The pump is our safety net —
        // proven to work, just slower.
        const startCanvasFallback = (reason: string) => {
          if (cancelled || fellBackToPump) return;
          fellBackToPump = true;
          console.warn(
            "[clips-popover] WebRTC bubble failed (%s) — starting canvas pump fallback",
            reason,
          );
          webrtcHandle?.stop();
          webrtcHandle = null;
          if (stream) {
            stopPump = startBubbleFramePump(stream);
          }
        };
        webrtcHandle = startBubbleWebrtc({
          stream: s,
          onConnected: () => {
            console.log(
              "[clips-popover] bubble WebRTC connected — video is live",
            );
          },
          onFailure: startCanvasFallback,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[clips-popover] camera acquisition failed:", err);
        const msg = err?.message ?? "";
        if (
          msg.includes("AVVideoCaptureSource") ||
          msg.includes("sandbox") ||
          err?.name === "NotAllowedError"
        ) {
          setCameraError(MACOS_CAPTURE_PERMISSION_MESSAGE);
        } else {
          setCameraError(`Camera unavailable: ${msg}`);
        }
      });

    return () => {
      cancelled = true;
      const transferred = bubbleStreamTransferredToRecorder.current;
      const recordingInFlight = recordingFlowGateRef.current;
      const trackCount = stream ? stream.getTracks().length : 0;
      console.log(
        "[clips-popover] bubble session end — transferred=%o recordingInFlight=%o tracks=%d hasWebrtc=%o hasPump=%o",
        transferred,
        recordingInFlight,
        trackCount,
        !!webrtcHandle,
        !!stopPump,
      );
      if (webrtcHandle) {
        webrtcHandle.stop();
        webrtcHandle = null;
      }
      if (stopPump) {
        stopPump();
        stopPump = null;
      }
      // Critical: if the recorder borrowed this stream, it now owns the
      // track lifecycle. Stopping tracks here would end them out from
      // under `MediaRecorder`, producing the laggy-bubble / dead-track
      // bug. The recorder will stop them on `stop()` / `cancel()`.
      if (stream && !transferred) {
        stream.getTracks().forEach((t) => t.stop());
        // Drop the local closure reference so nothing else pins the
        // (now-stopped) MediaStream. WebKit's MediaStream is backed by a
        // native track buffer that GC doesn't reclaim aggressively — any
        // dangling reference keeps it resident.
        stream = null;
      }
      // If the recorder owns the stream, keep `bubbleStreamRef` pointed
      // at it so the next re-entry of this effect (if any) doesn't try
      // to re-acquire while the recorder is still using it.
      if (!transferred) {
        bubbleStreamRef.current = null;
      }
      // Don't tear down overlays if a recording is still in flight (the
      // recorder's stop flow calls `hide_recording_chrome` which handles
      // the bubble correctly). Hiding here mid-flow would kill the
      // on-screen bubble window the user sees during the recording.
      if (!recordingInFlight) {
        invoke("hide_overlays").catch(() => {});
      }
    };
  }, [bubbleActive, cameraId]);

  // ---- auto-size popover to content --------------------------------------
  // The Tauri window is fixed-size via tauri.conf.json, but our content
  // height varies (more rows when a camera is on, Recent list toggle, etc.).
  // A ResizeObserver on the app shell tells Rust what the current
  // content height is and we call `resize_popover` to match.
  const appRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = appRef.current;
    if (!el) return;
    let last = 0;
    const push = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h && Math.abs(h - last) >= 2) {
        last = h;
        invoke("resize_popover", { height: h }).catch(() => {});
      }
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- recent list --------------------------------------------------------

  const fetchRecent = useCallback(async () => {
    if (authStatus !== "authed") return; // don't bother; would just 401
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/list-recordings?limit=3&sort=recent`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      const list = Array.isArray(json?.recordings) ? json.recordings : [];
      setRecordings(
        list.slice(0, 3).map((r: any) => ({
          id: r.id,
          title: r.title ?? "Untitled",
          durationMs: r.durationMs ?? 0,
          thumbnailUrl: r.thumbnailUrl ?? null,
          updatedAt: r.updatedAt ?? r.createdAt,
        })),
      );
    } catch {
      // ignore — server may be unreachable, we still render the chrome
    }
  }, [serverUrl, authStatus]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  // ---- persist selections -------------------------------------------------

  useEffect(() => saveString(MODE_KEY, mode), [mode]);
  useEffect(
    () => saveString(VOICE_SHORTCUT_KEY, voiceShortcut),
    [voiceShortcut],
  );
  useEffect(() => saveString(VOICE_MODE_KEY, voiceMode), [voiceMode]);
  useEffect(
    () => saveString(VOICE_PROVIDER_KEY, voiceProvider),
    [voiceProvider],
  );
  useEffect(() => saveString(SOURCE_KEY, source), [source]);
  useEffect(() => saveString(CAM_KEY, cameraId), [cameraId]);
  useEffect(() => saveString(MIC_KEY, micId), [micId]);
  useEffect(() => saveBool(CAM_ON_KEY, cameraOn), [cameraOn]);
  useEffect(() => saveBool(MIC_ON_KEY, micOn), [micOn]);

  // ---- actions -----------------------------------------------------------

  function openInBrowser(path: string) {
    const href = `${serverUrl.replace(/\/+$/, "")}${path}`;
    openExternal(href).catch((err) => {
      console.error("[clips-tray] open failed:", err);
    });
  }

  async function startRecording() {
    if (recorder) return;
    setRecError(null);
    console.log("[clips-popover] startRecording clicked", {
      serverUrl,
      mode,
      cameraOn,
      micOn,
    });
    // Latch BEFORE the async work so the popover stays in "recording
    // flow" during the macOS screen-picker focus dance. The bubble
    // session effect also keys off this flag (via `bubbleActive`) so
    // the bubble + camera stream stay alive while the picker is up.
    setRecordingFlowActive(true);
    // Tell Rust we're entering the recording flow NOW, not after the
    // handle arrives. The macOS screen-picker dialog steals focus from
    // the popover, which would otherwise trigger the blur-auto-hide
    // mid-setup — so the countdown and toolbar render behind a hidden
    // popover and the user sees nothing happen.
    invoke("set_recording_state", { active: true }).catch(() => {});

    // Hand the live camera stream to the recorder so it doesn't
    // re-acquire the camera (which would trigger WebKit's
    // capture-exclusion mute bug — see `preAcquiredCameraStream` in
    // recorder.ts). The popover KEEPS ownership: the bubble session
    // effect's deps still include `isRecording`, so the stream + bubble
    // + pump stay alive for the entire recording.
    const preAcquiredCameraStream =
      mode !== "screen" && cameraOn ? bubbleStreamRef.current : null;
    // Flip the ownership flag BEFORE kicking off the recorder. Any
    // bubble-session cleanup that fires after this point must leave the
    // tracks alone — the recorder now owns them. Cleared in the stop /
    // cancel / failure paths below.
    if (preAcquiredCameraStream) {
      bubbleStreamTransferredToRecorder.current = true;
    }

    let handle: RecorderHandle | null = null;
    let startError: unknown = null;
    try {
      // Per Steve: "when we hit Start Recording the popover should disappear
      // BEFORE the screen picker shows up — otherwise you might accidentally
      // pick the popover itself." NSWindowSharingNone keeps the popover out
      // of the final recording, but on modern macOS the picker STILL lists
      // NSWindowSharingNone windows — only the actual capture is blocked.
      // So we have to visually hide it early.
      //
      // We can't hide() the popover — that suspends its JS and the bubble
      // frame pump dies. Instead we park it as a 2×2 pinhole on the primary
      // screen (AppKit sees the window as on-screen, no occlusion
      // throttling, pump keeps ticking). The pinhole is too small to show
      // up prominently in the picker and since NSWindowSharingNone is also
      // set the picker's thumbnail is empty anyway.
      //
      // USER ACTIVATION: WebKit requires `getDisplayMedia` to be called
      // from within a user gesture handler. The first `await` in a click
      // handler consumes user activation. `startNativeRecording` kicks off
      // `getDisplayMedia` SYNCHRONOUSLY before its first `await`, so we
      // start the recording promise FIRST (capturing the gesture), then
      // park the popover in parallel via a fire-and-forget `invoke`.
      // `invoke` itself is async — but because `getDisplayMedia` was
      // already dispatched at that point, user activation has already been
      // consumed for the purpose that needs it.
      //
      // Set `clipsForceAlive` before parking so the bubble frame pump's
      // `document.hidden` early-out is bypassed even if WebKit flips
      // visibility=hidden on a pinhole-sized window.
      (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
        true;

      const recordingPromise = startNativeRecording({
        serverUrl,
        mode,
        cameraId,
        micId,
        cameraOn,
        micOn,
        preAcquiredCameraStream,
      });
      // Park the popover to its 2×2 pinhole IMMEDIATELY — we want the
      // popover to vanish the instant the user clicks Start, before the
      // screen picker has a chance to enumerate windows. Fire-and-forget;
      // the recording promise was already dispatched above so
      // getDisplayMedia has already captured the user gesture.
      invoke("park_popover_offscreen").catch(() => {});
      emit("clips:popover-visible", false).catch(() => {});

      // No watchdog — the macOS screen picker can stay open indefinitely
      // (a user deciding which window to capture may take 20, 60, 180
      // seconds). A false-positive timeout here fires recovery mid-setup,
      // which flips `recordingFlowActive` back to false → the bubble
      // session effect's cleanup runs and stops the popover-owned camera
      // stream → the recorder ends up with a dead track when the screen
      // picker finally resolves. If the user actually wants to abort,
      // canceling the picker throws NotAllowedError and we recover through
      // the normal error path.
      handle = await recordingPromise;
      console.log("[clips-popover] recorder handle received");
    } catch (err) {
      startError = err;
    } finally {
      // If the recorder handle was NEVER set, ALWAYS run recovery here —
      // even if downstream code throws before reaching the failure
      // branch. This makes the tray-dead symptom impossible: regardless
      // of WHICH step failed (stream acquisition, countdown, createRecording,
      // MediaRecorder.start, watchdog, unexpected throw), is_recording_active
      // is flipped back to false and the popover is re-shown.
      if (!handle) {
        console.warn(
          "[clips-popover] startRecording finally: no handle — running recovery",
        );
        // Clear the force-alive flag if it was latched before the failure.
        (window as unknown as { clipsForceAlive?: boolean }).clipsForceAlive =
          false;
        // Hand the stream back to the popover session. The recorder
        // never got far enough to take ownership of the tracks, so the
        // bubble-session effect must be allowed to stop them again on
        // its next cleanup (e.g. if the user closes the popover).
        bubbleStreamTransferredToRecorder.current = false;
        setRecordingFlowActive(false);
        try {
          await invoke("set_recording_state", { active: false });
        } catch {
          // ignore — best-effort
        }
        try {
          await invoke("show_popover");
        } catch {
          // ignore — best-effort
        }
      }
    }

    if (handle) {
      setRecorder(handle);
      return;
    }

    // Failure path — the recorder never came up. Side-effects (recording
    // flag + popover visibility) were already restored in the finally
    // block above. Now surface any non-cancel error to the UI.
    console.error("[clips-popover] startRecording failed:", startError);

    // User cancelled the macOS screen-picker (or denied permission).
    // WebKit throws DOMException `NotAllowedError` for BOTH cancel and
    // deny with the same message string, so we can't reliably tell them
    // apart — treat both as a silent no-op and return to pre-record
    // state. Some browsers throw `AbortError` on user abort instead.
    const errName =
      startError instanceof DOMException || startError instanceof Error
        ? startError.name
        : "";
    const message =
      startError instanceof Error ? startError.message : String(startError);
    if (errName === "AbortError" || /was cancelled|dismissed/i.test(message)) {
      return;
    }
    if (
      errName === "NotAllowedError" ||
      /NotAllowedError|permission denied by system|not allowed by the user agent|denied permission/i.test(
        message,
      )
    ) {
      setRecError(MACOS_CAPTURE_PERMISSION_MESSAGE);
      return;
    }
    setRecError(message);
  }

  // When the toolbar or countdown triggers stop/cancel the popover auto-
  // rehydrates into a "last recording" state so the user has a single-click
  // path to the playback page + knows the upload landed.
  useEffect(() => {
    if (!recorder) return;
    let cancelled = false;
    // Each Promise<UnlistenFn> is still pending when this effect might
    // already be tearing down (a fast stop→cancel toggle, or the effect
    // re-running due to a new recorder). If the unlisten arrives after
    // cleanup ran, call it immediately — otherwise Tauri keeps the
    // listener registered for the lifetime of the webview, and each
    // orphaned closure pins `recorder` + its MediaStream graph.
    const unlisteners: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlisteners.push(u);
      }).catch(() => {
        // ignore — best-effort
      });
    };
    track(
      listen("clips:recorder-stop", async () => {
        try {
          const { recordingId } = await recorder.stop();
          if (cancelled) return;
          setLastRecordingId(recordingId);
        } catch (err) {
          if (!cancelled)
            setRecError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) {
            // Clear the force-alive flag — recording is done, the pump
            // can honor document.hidden normally again.
            (
              window as unknown as { clipsForceAlive?: boolean }
            ).clipsForceAlive = false;
            // Recorder has stopped its tracks; next popover session can
            // acquire the camera cleanly again.
            bubbleStreamTransferredToRecorder.current = false;
            bubbleStreamRef.current = null;
            setRecorder(null);
            setRecordingFlowActive(false);
            invoke("set_recording_state", { active: false }).catch(() => {});
            // Close the popover — recorder.stop() already opened the
            // recording's page in the default browser. The popover doesn't
            // need to hang around.
            getCurrentWindow()
              .hide()
              .catch(() => {});
            emit("clips:popover-visible", false).catch(() => {});
            fetchRecent();
          }
        }
      }),
    );
    track(
      listen("clips:recorder-cancel", async () => {
        try {
          await recorder.cancel();
        } finally {
          if (!cancelled) {
            (
              window as unknown as { clipsForceAlive?: boolean }
            ).clipsForceAlive = false;
            bubbleStreamTransferredToRecorder.current = false;
            bubbleStreamRef.current = null;
            setRecorder(null);
            setRecordingFlowActive(false);
            invoke("set_recording_state", { active: false }).catch(() => {});
            invoke("show_popover").catch(() => {});
          }
        }
      }),
    );
    return () => {
      cancelled = true;
      unlisteners.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlisteners.length = 0;
    };
  }, [recorder, fetchRecent]);

  // Auto-hide on blur is handled on the Rust side (tauri::WindowEvent::Focused).

  const showCameraRow = mode !== "screen"; // screen-only has no camera
  const showSourceRow = mode !== "camera"; // camera-only has no screen source

  // During recording the popover is normally hidden — the tray click and the
  // global shortcut both emit `clips:recorder-stop` directly, and the
  // floating left-edge toolbar has the canonical Stop button. If the popover
  // does somehow end up visible (dock reopen, global-shortcut race, etc.),
  // we just render the normal pre-record panel so the user at least knows
  // where they are. No recording-only UI lives here.

  // When unauthenticated, render the sign-in form INLINE in the popover
  // (not a separate Tauri window). This avoids Tauri 2's separate-WebKit-
  // data-store-per-WebviewWindow cookie-jar issue — the cookie is set in
  // the same webview that reads it on the next /auth/session poll.
  // OAuth (Google / Apple) still needs a browser, so we offer that as a
  // secondary link via signInExternal().
  if (authStatus === "anon") {
    return (
      <div className="app" ref={appRef}>
        <Header mode={mode} onModeChange={setMode} />
        <UpdateBanner />
        {signInPending ? (
          <div className="signin-pending">
            <div className="signin-pending-spinner" />
            <p className="signin-pending-text">Waiting for browser sign-in…</p>
            <button
              type="button"
              className="signin-pending-cancel"
              onClick={() => {
                if (pollIntervalRef.current !== null) {
                  clearInterval(pollIntervalRef.current);
                  pollIntervalRef.current = null;
                }
                signInInflightRef.current = false;
                setSignInPending(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <SignInForm
            serverUrl={serverUrl}
            onSignedIn={async () => {
              await checkAuth();
            }}
            onUseBrowser={signInExternal}
          />
        )}
        <div className="footer">
          <a className="footer-link" onClick={() => setShowSettings(true)}>
            Settings
          </a>
        </div>
        {showSettings ? (
          <Setup
            initial={serverUrl}
            serverUrl={serverUrl}
            voiceShortcut={voiceShortcut}
            voiceMode={voiceMode}
            voiceProvider={voiceProvider}
            onVoiceShortcutChange={updateVoiceShortcut}
            onVoiceModeChange={setVoiceMode}
            onVoiceProviderChange={setVoiceProvider}
            onConnect={(url) => {
              saveString(STORAGE_KEY, url.replace(/\/+$/, ""));
              setServerUrl(url.replace(/\/+$/, ""));
              setShowSettings(false);
            }}
            onCancel={() => setShowSettings(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="app" ref={appRef}>
      <Header mode={mode} onModeChange={setMode} />
      <UpdateBanner />

      <div className="panel">
        {showSourceRow ? (
          <SourceRow value={source} onChange={setSource} />
        ) : null}

        {showCameraRow ? (
          <DeviceRow
            kind="camera"
            devices={cameras}
            selectedId={cameraId}
            onSelect={setCameraId}
            on={cameraOn}
            onToggle={setCameraOn}
          />
        ) : null}

        <DeviceRow
          kind="mic"
          devices={mics}
          selectedId={micId}
          onSelect={setMicId}
          on={micOn}
          onToggle={setMicOn}
        />
      </div>

      <button className="primary start" onClick={startRecording}>
        Start recording
      </button>
      {recError ? <div className="error-banner">{recError}</div> : null}
      {cameraError && !recError ? (
        <div className="error-banner">{cameraError}</div>
      ) : null}

      <div className="bottom-row">
        <BottomButton
          icon="library"
          label="Library"
          onClick={() => openInBrowser("/")}
        />
        <BottomButton
          icon="settings"
          label="Settings"
          onClick={() => setShowSettings(true)}
        />
        <BottomButton
          icon="recent"
          label="Recent"
          badge={undefined}
          onClick={() => setShowRecent((v) => !v)}
        />
      </div>

      {showRecent && recordings.length > 0 ? (
        <div className="recent-list">
          {recordings.map((r) => (
            <button
              key={r.id}
              className="recent-item"
              onClick={() => openInBrowser(`/r/${r.id}`)}
            >
              {r.thumbnailUrl ? (
                <img
                  className="thumb"
                  src={
                    r.thumbnailUrl.startsWith("http")
                      ? r.thumbnailUrl
                      : `${serverUrl.replace(/\/+$/, "")}${r.thumbnailUrl}`
                  }
                  alt=""
                />
              ) : (
                <div className="thumb thumb-placeholder" />
              )}
              <div className="recent-meta">
                <div className="recent-title">{r.title}</div>
                <div className="recent-sub">{formatAgo(r.updatedAt)}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {showSettings ? (
        <Setup
          initial={serverUrl}
          serverUrl={serverUrl}
          signedInAs={signedInAs}
          voiceShortcut={voiceShortcut}
          voiceMode={voiceMode}
          voiceProvider={voiceProvider}
          onVoiceShortcutChange={updateVoiceShortcut}
          onVoiceModeChange={setVoiceMode}
          onVoiceProviderChange={setVoiceProvider}
          onSignOut={signOut}
          onConnect={(url) => {
            saveString(STORAGE_KEY, url.replace(/\/+$/, ""));
            setServerUrl(url.replace(/\/+$/, ""));
            setShowSettings(false);
          }}
          onCancel={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function hidePopover() {
  // Hide the Tauri window + tell Rust so it can broadcast the
  // popover-visible=false event (which in turn tears down the bubble).
  getCurrentWindow()
    .hide()
    .catch(() => {});
  emit("clips:popover-visible", false).catch(() => {});
}

function Header({
  mode,
  onModeChange,
}: {
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
}) {
  // Mode-toggle is absolutely centered (visual center of the popover) and the
  // close button lives top-right as an absolute-positioned sibling, so the
  // tabs aren't offset by the close button's width.
  return (
    <div className="header header-centered">
      <div
        className="mode-toggle"
        role="radiogroup"
        aria-label="Recording mode"
      >
        <button
          className={mode === "screen" ? "active" : ""}
          onClick={() => onModeChange("screen")}
          aria-label="Screen only"
          title="Screen only"
        >
          <ScreenIcon />
        </button>
        <button
          className={mode === "screen-camera" ? "active" : ""}
          onClick={() => onModeChange("screen-camera")}
          aria-label="Screen + Camera"
          title="Screen + Camera"
        >
          <ScreenCamIcon />
        </button>
        <button
          className={mode === "camera" ? "active" : ""}
          onClick={() => onModeChange("camera")}
          aria-label="Camera only"
          title="Camera only"
        >
          <CamIcon />
        </button>
      </div>
      <button
        className="icon-button header-close"
        onClick={hidePopover}
        aria-label="Close"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function SignInForm({
  serverUrl,
  onSignedIn,
  onUseBrowser,
}: {
  serverUrl: string;
  onSignedIn: () => Promise<void> | void;
  onUseBrowser: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Post to the framework's Better Auth-backed email/password endpoint.
      // credentials: "include" ensures the session cookie is attached to
      // this webview's jar — and because we poll /auth/session from the
      // SAME webview, it resolves correctly (unlike the previous separate-
      // window flow, where Tauri 2 gave each webview its own WebKit data
      // store and the cookie never reached the popover).
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/_agent-native/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
          credentials: "include",
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Sign in failed (${res.status})`);
      }
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="signin" onSubmit={onSubmit}>
      <div className="signin-title">Sign in to Clips</div>
      <input
        ref={emailRef}
        type="email"
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error ? <div className="error-banner">{error}</div> : null}
      <button
        type="submit"
        className="primary start"
        disabled={submitting || !email || !password}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      <div className="signin-divider">
        <span>or</span>
      </div>
      <button
        type="button"
        className="signin-google"
        onClick={onUseBrowser}
        title="Opens your default browser to complete Google sign-in"
      >
        <GoogleIcon />
        Continue with Google
      </button>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96L3.97 7.3C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function SourceRow({
  value,
  onChange,
}: {
  value: CaptureSource;
  onChange: (v: CaptureSource) => void;
}) {
  const labels: Record<CaptureSource, string> = {
    "full-screen": "Full screen",
    window: "Window",
    tab: "Browser tab",
    custom: "Custom area",
  };
  return (
    <label className="row">
      <span className="row-icon">
        <MonitorIcon />
      </span>
      <select
        className="row-select"
        value={value}
        onChange={(e) => onChange(e.target.value as CaptureSource)}
      >
        {Object.entries(labels).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DeviceRow({
  kind,
  devices,
  selectedId,
  onSelect,
  on,
  onToggle,
}: {
  kind: "camera" | "mic";
  devices: MediaDeviceInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  const current = useMemo(
    () => devices.find((d) => d.deviceId === selectedId) ?? devices[0],
    [devices, selectedId],
  );
  const label =
    current?.label || (kind === "camera" ? "Default camera" : "Default mic");
  const Icon = kind === "camera" ? CameraIcon : MicIcon;

  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click — native-feeling popover behavior.
  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      const el = rowRef.current;
      if (!el) return;
      if (!el.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabled = !on || devices.length === 0;
  return (
    <div className={`row ${on ? "row-on" : "row-off"}`} ref={rowRef}>
      <span className="row-icon">
        <Icon />
      </span>
      <button
        type="button"
        className="row-button"
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={label}
      >
        <span className="row-label">{label}</span>
        <span className="row-chev" aria-hidden>
          <ChevronDown />
        </span>
      </button>
      <Toggle
        on={on}
        onChange={onToggle}
        label={kind === "camera" ? "Camera" : "Microphone"}
      />
      {kind === "mic" && on ? <MicWave /> : null}
      {open ? (
        <div className="row-menu" role="menu">
          {devices.length === 0 ? (
            <div className="row-menu-empty">
              {kind === "camera" ? "No cameras found" : "No microphones found"}
            </div>
          ) : (
            devices.map((d) => {
              const isSelected = d.deviceId === (current?.deviceId ?? "");
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  className={`row-menu-item ${isSelected ? "selected" : ""}`}
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    onSelect(d.deviceId);
                    setOpen(false);
                  }}
                >
                  <span className="row-menu-check" aria-hidden>
                    {isSelected ? <CheckIcon /> : null}
                  </span>
                  <span className="row-menu-label">
                    {d.label || (kind === "camera" ? "Camera" : "Microphone")}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${on ? "toggle-on" : "toggle-off"}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

// Slim track-with-thumb switch (shadcn-style). type="button" is required so
// it doesn't submit any enclosing form.
function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`switch ${on ? "switch-on" : "switch-off"}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="switch-thumb" aria-hidden />
    </button>
  );
}

function MicWave() {
  // Purely decorative — animates four bars to suggest input level. For real
  // input level we'd need a live stream, which Loom starts only on "Start".
  return (
    <span className="mic-wave" aria-hidden>
      <span className="bar b1" />
      <span className="bar b2" />
      <span className="bar b3" />
      <span className="bar b4" />
    </span>
  );
}

function BottomButton({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: "library" | "settings" | "recent";
  label: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button className="bottom-btn" onClick={onClick}>
      <span className="bottom-icon">
        {icon === "library" ? (
          <LibraryIcon />
        ) : icon === "settings" ? (
          <SettingsIcon />
        ) : (
          <ClockIcon />
        )}
        {badge ? <span className="badge">{badge}</span> : null}
      </span>
      <span className="bottom-label">{label}</span>
    </button>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---- inline icons (Tabler-style, monochrome, stroke=1.75) -----------------

function ScreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 20h8M12 16v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ScreenCamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle
        cx="17.5"
        cy="15.5"
        r="4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg)"
      />
      <circle cx="17.5" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="7"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M17 10l4-2v8l-4-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="7"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M17 10l4-2v8l-4-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="9"
        y="3"
        width="6"
        height="12"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5 11a7 7 0 0014 0M12 18v3M9 21h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12l5 5 9-11"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LibraryIcon() {
  // Four rounded tiles — "grid of clips" metaphor.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="13.5"
        y="3.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="3.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="13.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function SettingsIcon() {
  // Horizontal sliders — reads cleaner at small sizes than a cogwheel.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h10M18 7h2M4 17h2M10 17h10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle
        cx="16"
        cy="7"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg, #000)"
      />
      <circle
        cx="8"
        cy="17"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="var(--bg, #000)"
      />
    </svg>
  );
}

function ClockIcon() {
  // Counter-clockwise arrow — "history / recent" metaphor.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 9a8 8 0 1 1 .5 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 4v5h5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8v4l2.5 1.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------

type VoiceProviderStatus = {
  browser: true;
  // Apple's SFSpeechRecognizer + AVAudioEngine driven from Rust. The
  // server reports `true` whenever it's available; the desktop client
  // additionally has it gated to macOS at the Tauri-command layer.
  "macos-native": boolean;
  builder: boolean;
  gemini: boolean;
  openai: boolean;
  groq: boolean;
};

function Setup({
  initial,
  serverUrl,
  signedInAs,
  voiceShortcut,
  voiceMode,
  voiceProvider,
  onVoiceShortcutChange,
  onVoiceModeChange,
  onVoiceProviderChange,
  onConnect,
  onCancel,
  onSignOut,
}: {
  initial?: string | null;
  serverUrl?: string;
  signedInAs?: string | null;
  voiceShortcut: VoiceShortcutPreference;
  voiceMode: VoiceMode;
  voiceProvider: VoiceProvider;
  onVoiceShortcutChange: (value: VoiceShortcutPreference) => void;
  onVoiceModeChange: (value: VoiceMode) => void;
  onVoiceProviderChange: (value: VoiceProvider) => void;
  onConnect: (url: string) => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}) {
  const [url, setUrl] = useState(initial ?? DEFAULT_URL);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const featureConfig = useFeatureConfig();
  const voiceEnabled = featureConfig?.voiceEnabled !== false;
  const [providerStatus, setProviderStatus] =
    useState<VoiceProviderStatus | null>(null);
  const [providerStatusLoading, setProviderStatusLoading] = useState(true);

  function setVoiceEnabled(enabled: boolean) {
    if (!featureConfig) return;
    invoke("set_feature_config", {
      config: { ...featureConfig, voiceEnabled: enabled },
    }).catch((err) =>
      console.error("[settings] set_feature_config failed", err),
    );
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const base = (serverUrl ?? initial ?? DEFAULT_URL).replace(/\/+$/, "");
    let cancelled = false;
    setProviderStatusLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `${base}/_agent-native/voice-providers/status`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (!cancelled) {
            setProviderStatus(null);
            setProviderStatusLoading(false);
          }
          return;
        }
        // Server emits `native` (no namespace); the client uses
        // `"macos-native"` as the provider key throughout — remap on the
        // way in.
        const json = (await res.json().catch(() => null)) as
          | (Partial<Omit<VoiceProviderStatus, "browser" | "macos-native">> & {
              native?: boolean;
            })
          | null;
        if (cancelled) return;
        setProviderStatus({
          browser: true,
          "macos-native": Boolean(json?.native),
          builder: Boolean(json?.builder),
          gemini: Boolean(json?.gemini),
          openai: Boolean(json?.openai),
          groq: Boolean(json?.groq),
        });
        setProviderStatusLoading(false);
      } catch {
        if (!cancelled) {
          setProviderStatus(null);
          setProviderStatusLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, initial]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    onConnect(trimmed);
  }

  const providerHint: Record<VoiceProvider, string> = {
    auto: "Picks the best available provider for your setup.",
    browser: "Free Web Speech dictation. Cross-platform; quality varies.",
    "macos-native":
      "Apple's on-device dictation via SFSpeechRecognizer. Fastest and most reliable on macOS.",
    builder: "Builder.io's transcription. Needs BUILDER_PRIVATE_KEY.",
    gemini: "Google Gemini Flash Lite. Needs GEMINI_API_KEY.",
    openai: "OpenAI Whisper. Needs OPENAI_API_KEY.",
    groq: "Groq Whisper — fastest cloud option. Needs GROQ_API_KEY.",
  };
  const shortcutHint: Record<VoiceShortcutPreference, string> = {
    fn: "Press the Fn / globe key to dictate.",
    "cmd-shift-space": "Press Cmd+Shift+Space to dictate.",
    "ctrl-shift-space": "Press Ctrl+Shift+Space to dictate.",
    both: "Any of Fn, Cmd+Shift+Space, or Ctrl+Shift+Space.",
  };
  const modeHint: Record<VoiceMode, string> = {
    "push-to-talk": "Hold the shortcut while speaking. Release to stop.",
    toggle: "Press once to start, again to stop.",
  };

  // Only warn when the selected provider has no key on the server. Avoids
  // showing four "missing key" rows at all times.
  const providerWarning: string | null = (() => {
    if (providerStatusLoading || !providerStatus) return null;
    if (
      voiceProvider === "browser" ||
      voiceProvider === "macos-native" ||
      voiceProvider === "auto"
    ) {
      return null;
    }
    if (providerStatus[voiceProvider]) return null;
    const envKey = {
      builder: "BUILDER_PRIVATE_KEY",
      gemini: "GEMINI_API_KEY",
      openai: "OPENAI_API_KEY",
      groq: "GROQ_API_KEY",
    }[voiceProvider];
    return `${envKey} not set on the server — falling back to browser.`;
  })();

  return (
    <form className="setup" onSubmit={handleSubmit}>
      <div className="setup-header">
        {onCancel ? (
          <button
            type="button"
            className="setup-back"
            onClick={onCancel}
            aria-label="Back"
          >
            <IconArrowLeft size={18} stroke={1.75} />
          </button>
        ) : null}
        <h2>Settings</h2>
      </div>

      <div className="setup-section">
        <SettingLabel
          label="Clips server URL"
          hint="The URL of the Clips backend this tray app connects to."
          htmlFor="clips-url"
        />
        <input
          id="clips-url"
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8080"
        />
        <button className="primary" type="submit">
          Connect
        </button>
      </div>

      <div className="setup-section">
        <div className="setup-toggle-row">
          <SettingLabel
            label="Voice dictation"
            hint="Speak to type anywhere on your Mac. Turn off to disable globally and remove the keyboard shortcuts."
          />
          <Switch
            on={voiceEnabled}
            onChange={setVoiceEnabled}
            label="Enable voice dictation"
          />
        </div>
      </div>

      {voiceEnabled ? (
        <>
          <div className="setup-section">
            <SettingLabel
              label="Provider"
              hint="Where audio is sent for transcription. Browser is free; cloud providers need an API key set on the server."
              htmlFor="voice-provider"
            />
            <select
              id="voice-provider"
              className="setup-select"
              value={voiceProvider}
              onChange={(event) =>
                onVoiceProviderChange(event.target.value as VoiceProvider)
              }
            >
              <option value="auto">Auto (recommended)</option>
              <option value="browser">Browser (free, built-in)</option>
              {typeof navigator !== "undefined" &&
              /Mac/i.test(navigator.platform) ? (
                <option value="macos-native">
                  macOS native (on-device, fastest)
                </option>
              ) : null}
              <option value="builder">Builder.io</option>
              <option value="gemini">Google Gemini Flash Lite</option>
              <option value="openai">OpenAI Whisper</option>
              <option value="groq">Groq Whisper</option>
            </select>
            <p className="setup-hint">{providerHint[voiceProvider]}</p>
            {providerWarning ? (
              <p className="setup-warning">{providerWarning}</p>
            ) : null}
          </div>

          <div className="setup-section">
            <SettingLabel
              label="Shortcut"
              hint="The key combination that triggers voice dictation."
              htmlFor="voice-shortcut"
            />
            <select
              id="voice-shortcut"
              className="setup-select"
              value={voiceShortcut}
              onChange={(event) =>
                onVoiceShortcutChange(
                  event.target.value as VoiceShortcutPreference,
                )
              }
            >
              <option value="fn">Fn (globe) key</option>
              <option value="cmd-shift-space">Cmd+Shift+Space</option>
              <option value="ctrl-shift-space">Ctrl+Shift+Space</option>
              <option value="both">All shortcuts</option>
            </select>
            <p className="setup-hint">{shortcutHint[voiceShortcut]}</p>
          </div>

          <div className="setup-section">
            <SettingLabel
              label="Mode"
              hint="Whether you hold the shortcut while speaking or toggle it on and off."
              htmlFor="voice-mode"
            />
            <select
              id="voice-mode"
              className="setup-select"
              value={voiceMode}
              onChange={(event) =>
                onVoiceModeChange(event.target.value as VoiceMode)
              }
            >
              <option value="push-to-talk">Hold to dictate</option>
              <option value="toggle">Press to start, press to stop</option>
            </select>
            <p className="setup-hint">{modeHint[voiceMode]}</p>
          </div>
        </>
      ) : null}
      {signedInAs && onSignOut ? (
        <div className="setup-account">
          <span className="setup-account-email">{signedInAs}</span>
          <button
            type="button"
            className="link-button"
            onClick={onSignOut}
            style={{ background: "transparent", border: "none" }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </form>
  );
}

function SettingLabel({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint: string;
  htmlFor?: string;
}) {
  return (
    <label className="setup-label" htmlFor={htmlFor}>
      <span>{label}</span>
      <span className="setup-help" title={hint} aria-label={hint} role="img">
        <IconInfoCircle size={14} stroke={1.75} />
      </span>
    </label>
  );
}
