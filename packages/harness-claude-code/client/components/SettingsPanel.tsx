import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { IconStar, IconStarFilled, IconX } from "@tabler/icons-react";
import { type LaunchSettings } from "../lib/settings";

const URL_HISTORY_KEY = "harness:urlHistory";
const URL_STARRED_KEY = "harness:urlStarred";
const MAX_HISTORY = 20;

function loadUrlHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(URL_HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function saveUrlHistory(h: string[]) {
  localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(h));
}
function loadStarred(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(URL_STARRED_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveStarred(s: Set<string>) {
  localStorage.setItem(URL_STARRED_KEY, JSON.stringify([...s]));
}

interface SettingsPanelProps {
  settings: LaunchSettings;
  onChange: (s: LaunchSettings) => void;
  appPort: number;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  connected: boolean;
}

export function SettingsPanel({ settings, onChange, appPort, iframeRef, connected }: SettingsPanelProps) {
  const update = (patch: Partial<LaunchSettings>) =>
    onChange({ ...settings, ...patch });

  const [urlInput, setUrlInput] = useState("/");
  const [history, setHistory] = useState<string[]>(loadUrlHistory);
  const [starred, setStarred] = useState<Set<string>>(loadStarred);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track current iframe path
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const update = () => {
      try {
        const url = new URL(iframe.contentWindow?.location.href || "");
        const path = url.pathname + url.search + url.hash;
        setUrlInput(path);
        addToHistory(path);
      } catch { /* cross-origin */ }
    };
    update();
    iframe.addEventListener("load", update);
    return () => iframe.removeEventListener("load", update);
  }, [iframeRef]);

  const addToHistory = (path: string) => {
    if (!path || path === "/") return;
    setHistory((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, MAX_HISTORY);
      saveUrlHistory(next);
      return next;
    });
  };

  const singlePort = new URLSearchParams(location.search).get("singlePort") === "1";

  const navigate = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const normalized = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
    if (iframeRef.current) {
      iframeRef.current.src = singlePort
        ? `/app${normalized}`
        : `http://localhost:${appPort}${normalized}`;
    }
    setUrlInput(normalized);
    addToHistory(normalized);
  }, [iframeRef, appPort, singlePort]);

  const toggleStar = (path: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      saveStarred(next);
      return next;
    });
  };

  const removeUrl = (path: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      next.delete(path);
      saveStarred(next);
      return next;
    });
    setHistory((prev) => {
      const next = prev.filter((p) => p !== path);
      saveUrlHistory(next);
      return next;
    });
  };

  const sortedHistory = [...history].sort((a, b) => {
    const aS = starred.has(a);
    const bS = starred.has(b);
    if (aS && !bS) return -1;
    if (!aS && bS) return 1;
    return 0;
  });

  return (
    <div className="absolute top-9 right-0 bg-[#2a2a2a] border border-white/10 rounded-lg p-3 z-50 min-w-[300px] shadow-2xl">
      {/* Preview URL */}
      <h3 className="text-[12px] font-medium text-white/70 mb-1.5">
        Preview URL
      </h3>
      <div className="flex gap-1.5 mb-1">
        <input
          ref={inputRef}
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") navigate(urlInput); }}
          placeholder="/path"
          className="flex-1 bg-[#1e1e1e] border border-white/10 rounded px-2 py-1 text-xs text-white/80 font-mono focus:outline-none focus:border-blue-500 min-w-0"
          spellCheck={false}
        />
        <button
          onClick={() => navigate(urlInput)}
          className="px-2 py-1 text-[11px] bg-white/[0.06] hover:bg-white/10 text-white/60 hover:text-white/90 rounded transition-colors shrink-0"
        >
          Go
        </button>
      </div>
      {sortedHistory.length > 0 && (
        <div className="max-h-[120px] overflow-y-auto mt-1 -mx-1">
          {sortedHistory.map((path) => (
            <div
              key={path}
              onClick={() => navigate(path)}
              className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-white/5 transition-colors group mx-1"
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggleStar(path); }}
                className="shrink-0 text-white/20 hover:text-amber-400 transition-colors"
              >
                {starred.has(path) ? (
                  <IconStarFilled size={11} className="text-amber-400" />
                ) : (
                  <IconStar size={11} />
                )}
              </button>
              <span className="text-[11px] text-white/50 font-mono truncate flex-1">
                {path}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeUrl(path); }}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-white/60 transition-all"
              >
                <IconX size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-white/10 my-2" />

      {/* Harness */}
      <div className="flex items-center justify-between py-1">
        <span className="text-[12px] font-medium text-white/70">Harness</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white/80">Claude Code</span>
          <span className={`flex items-center gap-1 text-[10px] ${connected ? "text-green-400" : "text-red-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
      <p className="text-[11px] text-white/30 mb-1 leading-relaxed">
        Local CLI-powered.{" "}
        <a
          href="https://www.builder.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400/60 hover:text-blue-300"
        >
          Builder
        </a>{" "}
        available for teams, cloud, and collaboration.
      </p>

      <div className="border-t border-white/10 my-2" />

      {/* Launch Options */}
      <h3 className="text-[12px] font-medium text-white/70 mb-2">
        Launch Options
      </h3>

      <label className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 cursor-pointer py-1">
        <input
          type="checkbox"
          checked={settings.skipPermissions}
          onChange={(e) => update({ skipPermissions: e.target.checked })}
          className="accent-blue-500"
        />
        --dangerously-skip-permissions
      </label>
      <p className="text-[11px] text-white/30 ml-5 mb-2">
        Auto-accept all tool use (no confirmation prompts)
      </p>

      <label className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 cursor-pointer py-1">
        <input
          type="checkbox"
          checked={settings.resume}
          onChange={(e) => update({ resume: e.target.checked })}
          className="accent-blue-500"
        />
        --resume
      </label>
      <p className="text-[11px] text-white/30 ml-5 mb-2">
        Resume the most recent conversation
      </p>

      <label className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 cursor-pointer py-1">
        <input
          type="checkbox"
          checked={settings.verbose}
          onChange={(e) => update({ verbose: e.target.checked })}
          className="accent-blue-500"
        />
        --verbose
      </label>
      <p className="text-[11px] text-white/30 ml-5 mb-2">
        Enable verbose logging output
      </p>

      <div className="border-t border-white/10 my-2" />

      <label className="text-xs text-white/60">Additional flags</label>
      <input
        type="text"
        value={settings.custom}
        onChange={(e) => update({ custom: e.target.value })}
        placeholder='e.g. --model sonnet --print "hello"'
        className="w-full mt-1 bg-[#1e1e1e] border border-white/10 rounded px-2 py-1 text-xs text-white/80 font-mono focus:outline-none focus:border-blue-500"
      />
      <p className="text-[11px] text-white/30 mt-1">
        Space-separated flags appended to the command
      </p>
    </div>
  );
}
