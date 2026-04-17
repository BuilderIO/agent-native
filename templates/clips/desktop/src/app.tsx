import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startNativeRecording, type RecorderHandle } from "./lib/recorder";

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

  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [recorder, setRecorder] = useState<RecorderHandle | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<"unknown" | "authed" | "anon">(
    "unknown",
  );
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const isRecording = recorder !== null;

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

  async function signIn() {
    await invoke("show_signin", {
      url: `${serverUrl.replace(/\/+$/, "")}/login`,
    }).catch(() => {});
    // Poll for auth — close the signin window automatically when the
    // session lands (usually right after the login redirect).
    const start = Date.now();
    const interval = setInterval(async () => {
      const ok = await checkAuth();
      if (ok || Date.now() - start > 120_000) {
        clearInterval(interval);
        if (ok) invoke("close_signin").catch(() => {});
      }
    }, 1500);
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
    // Probe mic + camera to unlock labels. Stream is stopped immediately —
    // we only needed the permission grant.
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        // permission denied — labels will stay empty until user grants
      }
    }
    await loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    loadDevices();
    unlockDeviceLabels();
  }, [loadDevices, unlockDeviceLabels]);

  // ---- pre-record camera bubble overlay -----------------------------------
  // As soon as the popover has a camera configured we drop the bubble into
  // the bottom-left of the screen so the user can drag it into place before
  // hitting record. Nothing renders inside the popover itself — the popover
  // is config, not capture.

  const showBubblePreview = mode !== "screen" && cameraOn && !isRecording;

  useEffect(() => {
    if (!showBubblePreview) {
      invoke("hide_overlays").catch(() => {});
      return;
    }
    invoke("show_bubble").catch(() => {});
    const t = setTimeout(() => {
      emit("clips:bubble-config", { deviceId: cameraId }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [showBubblePreview, cameraId]);

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
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/list-recordings?limit=3&sort=recent`;
      const res = await fetch(url);
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
  }, [serverUrl]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  // ---- persist selections -------------------------------------------------

  useEffect(() => saveString(MODE_KEY, mode), [mode]);
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
    try {
      const handle = await startNativeRecording({
        serverUrl,
        mode,
        cameraId,
        micId,
        cameraOn,
        micOn,
      });
      setRecorder(handle);
      // Quietly hide the popover — the toolbar + bubble + countdown
      // overlays are the user-facing surface from this point on.
      getCurrentWindow()
        .hide()
        .catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // getDisplayMedia throws `NotAllowedError` when the user cancels the
      // system picker. That's expected, not an error to show.
      if (!/NotAllowed|dismissed/i.test(message)) setRecError(message);
    }
  }

  // When the toolbar or countdown triggers stop/cancel the popover auto-
  // rehydrates into a "last recording" state so the user has a single-click
  // path to the playback page + knows the upload landed.
  useEffect(() => {
    if (!recorder) return;
    let cancelled = false;
    const unlisteners: Array<Promise<() => void>> = [
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
            setRecorder(null);
            invoke("show_popover").catch(() => {});
            fetchRecent();
          }
        }
      }),
      listen("clips:recorder-cancel", async () => {
        try {
          await recorder.cancel();
        } finally {
          if (!cancelled) {
            setRecorder(null);
            invoke("show_popover").catch(() => {});
          }
        }
      }),
    ];
    return () => {
      cancelled = true;
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
    };
  }, [recorder, fetchRecent]);

  // Auto-hide on blur is handled on the Rust side (tauri::WindowEvent::Focused).

  const showCameraRow = mode !== "screen"; // screen-only has no camera
  const showSourceRow = mode !== "camera"; // camera-only has no screen source

  return (
    <div className="app" ref={appRef}>
      <Header mode={mode} onModeChange={setMode} />

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

      {authStatus === "anon" ? (
        <button className="primary start" onClick={signIn}>
          Sign in to Clips
        </button>
      ) : lastRecordingId && !isRecording ? (
        <button
          className="primary start"
          onClick={() => openInBrowser(`/r/${lastRecordingId}`)}
        >
          <span className="rec-dot" aria-hidden />
          View last recording
        </button>
      ) : (
        <button
          className="primary start"
          onClick={startRecording}
          disabled={isRecording}
        >
          <span className="rec-dot" aria-hidden />
          {isRecording ? "Recording…" : "Start recording"}
        </button>
      )}
      {recError ? <div className="error-banner">{recError}</div> : null}

      <div className="bottom-row">
        <BottomButton
          icon="library"
          label="Library"
          onClick={() => openInBrowser("/")}
        />
        <BottomButton
          icon="settings"
          label="Settings"
          onClick={() => openInBrowser("/settings")}
        />
        <BottomButton
          icon="recent"
          label="Recent"
          badge={recordings.length > 0 ? String(recordings.length) : undefined}
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

      <div className="footer">
        <span className="kbd">⌘⇧L</span>
        <a className="footer-link" onClick={() => setShowSettings(true)}>
          Change server
        </a>
      </div>

      {showSettings ? (
        <Setup
          initial={serverUrl}
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

function Header({
  mode,
  onModeChange,
}: {
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
}) {
  return (
    <div className="header">
      <div className="logo">C</div>
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
        className="icon-button"
        onClick={() => window.close?.()}
        aria-label="Close"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
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
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M10 9l5 3-5 3z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="currentColor"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M19.4 15a7.97 7.97 0 00.1-3l1.9-1.3-2-3.5-2.2.8a8 8 0 00-2.6-1.5L14 4h-4l-.6 2.5a8 8 0 00-2.6 1.5L4.6 7.2l-2 3.5L4.5 12a7.97 7.97 0 00.1 3l-1.9 1.3 2 3.5 2.2-.8a8 8 0 002.6 1.5L10 23h4l.6-2.5a8 8 0 002.6-1.5l2.2.8 2-3.5-1.9-1.3z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------

function Setup({
  initial,
  onConnect,
  onCancel,
}: {
  initial?: string | null;
  onConnect: (url: string) => void;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState(initial ?? DEFAULT_URL);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    onConnect(trimmed);
  }

  return (
    <form className="setup" onSubmit={handleSubmit}>
      <h2>Connect to your Clips server</h2>
      <p>Enter the URL of your running Clips instance.</p>
      <input
        ref={inputRef}
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://localhost:8080"
      />
      <button className="primary" type="submit">
        Connect
      </button>
      {onCancel ? (
        <button
          type="button"
          className="link-button"
          onClick={onCancel}
          style={{ background: "transparent", border: "none" }}
        >
          Cancel
        </button>
      ) : null}
    </form>
  );
}
