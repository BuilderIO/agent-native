import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";

interface RecordingSummary {
  id: string;
  title: string;
  durationMs: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

const STORAGE_KEY = "clips:server-url";
const DEFAULT_URL = "http://localhost:8080";

function loadServerUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ""));
  } catch {
    // non-fatal
  }
}

function formatDuration(ms: number): string {
  if (!ms) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  const [serverUrl, setServerUrl] = useState<string | null>(loadServerUrl());
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const fetchRecent = useCallback(async () => {
    if (!serverUrl) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/list-recordings?limit=3&sort=recent`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  if (!serverUrl) {
    return (
      <Setup
        onConnect={(url) => {
          saveServerUrl(url);
          setServerUrl(url.replace(/\/+$/, ""));
        }}
      />
    );
  }

  function openInBrowser(path: string) {
    const href = `${serverUrl!.replace(/\/+$/, "")}${path}`;
    openExternal(href).catch((err) => {
      console.error("[clips-tray] open failed:", err);
    });
  }

  return (
    <div className="app">
      <div className="header">
        <div className="logo">C</div>
        <div className="title">Clips</div>
        <div className="spacer" />
        <button
          className="icon-button"
          onClick={() => fetchRecent()}
          aria-label="Refresh"
          title="Refresh"
        >
          ↻
        </button>
        <button
          className="icon-button"
          onClick={() => setShowSettings(true)}
          aria-label="Server"
          title="Change server URL"
        >
          ⚙
        </button>
      </div>

      <button className="primary" onClick={() => openInBrowser("/record")}>
        <span aria-hidden>●</span>
        New recording
      </button>

      <div>
        <div className="section-label">Recent</div>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : recordings.length === 0 ? (
          <div className="empty">No recordings yet</div>
        ) : (
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
                  <div className="thumb" />
                )}
                <div className="recent-meta">
                  <div className="recent-title">{r.title}</div>
                  <div className="recent-sub">
                    {formatDuration(r.durationMs)} · {formatAgo(r.updatedAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="links">
        <button className="link-button" onClick={() => openInBrowser("/")}>
          Open library
        </button>
        <button
          className="link-button"
          onClick={() => openInBrowser("/settings")}
        >
          Settings
        </button>
      </div>

      <div className="footer">
        <span>Cmd/Ctrl+Shift+L</span>
        <a onClick={() => setShowSettings(true)}>Change server</a>
      </div>

      {showSettings ? (
        <Setup
          initial={serverUrl}
          onConnect={(url) => {
            saveServerUrl(url);
            setServerUrl(url.replace(/\/+$/, ""));
            setShowSettings(false);
          }}
          onCancel={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}

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
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://localhost:8080"
        autoFocus
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
