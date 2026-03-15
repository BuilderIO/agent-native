import { type RefObject } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { type LaunchSettings } from "../lib/settings";
import { useHarnessConfig, type HarnessConfig } from "../lib/config";


interface SettingsPanelProps {
  settings: LaunchSettings;
  onChange: (s: LaunchSettings) => void;
  onRestart: () => void;
  appUrl: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  connected: boolean;
  apps: Array<{ name: string; appPort: number; wsPort: number }>;
  activeApp: string;
  onSwitchApp: (name: string) => void;
  harnesses: HarnessConfig[];
  onSwitchHarness: (command: string) => void;
}

export function SettingsPanel({
  settings,
  onChange,
  onRestart,
  appUrl,
  iframeRef,
  connected,
  apps,
  activeApp,
  onSwitchApp,
  harnesses,
  onSwitchHarness,
}: SettingsPanelProps) {
  const config = useHarnessConfig();

  const update = (patch: Partial<LaunchSettings>) =>
    onChange({ ...settings, ...patch });

  const updateOption = (key: string, value: boolean) =>
    onChange({ ...settings, options: { ...settings.options, [key]: value } });

  return (
    <div className="absolute top-9 left-0 bg-[#2a2a2a] border border-white/10 rounded-lg p-3 z-50 min-w-[300px] max-h-[calc(100vh-60px)] overflow-y-auto shadow-2xl">
      {/* Template Picker */}
      {apps.length > 1 && (
        <>
          <h3 className="text-[12px] font-medium text-white/70 mb-1.5">
            Template
          </h3>
          <div className="flex flex-wrap gap-1 mb-2">
            {apps.map((app) => (
              <button
                key={app.name}
                onClick={() => onSwitchApp(app.name)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  app.name === activeApp
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "bg-white/[0.04] text-white/50 hover:text-white/80 hover:bg-white/[0.08] border border-transparent"
                }`}
              >
                {app.name}
              </button>
            ))}
          </div>
          <div className="border-t border-white/10 my-2" />
        </>
      )}

      {/* Harness Picker */}
      <h3 className="text-[12px] font-medium text-white/70 mb-1.5">Harness</h3>
      {harnesses.length > 1 ? (
        <div className="flex flex-wrap gap-1 mb-1">
          {harnesses.map((h) => (
            <button
              key={h.command}
              onClick={() => onSwitchHarness(h.command)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                h.command === config.command
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-white/[0.04] text-white/50 hover:text-white/80 hover:bg-white/[0.08] border border-transparent"
              }`}
            >
              {h.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] font-medium text-white/80">
            {config.name}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 mt-1">
        <span
          className={`flex items-center gap-1 text-[10px] ${connected ? "text-green-400" : "text-red-400"}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
          />
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <p className="text-[11px] text-white/30 mt-1 mb-1 leading-relaxed">
        Local CLI-powered. For teams, cloud, and collaboration use{" "}
        <a
          href="https://www.builder.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400/60 hover:text-blue-300"
        >
          Builder.io
        </a>
        .
      </p>

      <div className="border-t border-white/10 my-2" />

      <label className="text-xs text-white/60">Launch flags</label>
      <input
        type="text"
        value={settings.custom}
        onChange={(e) => update({ custom: e.target.value })}
        placeholder={config.customPlaceholder}
        className="w-full mt-1 bg-[#1e1e1e] border border-white/10 rounded px-2 py-1 text-xs text-white/80 font-mono focus:outline-none focus:border-blue-500"
      />
      <p className="text-[11px] text-white/30 mt-1">
        Space-separated flags appended to the command
      </p>

      <div className="border-t border-white/10 my-2" />

      <button
        onClick={onRestart}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <IconRefresh size={13} stroke={1.5} />
        Restart {config.name}
      </button>
      <p className="text-[11px] text-white/30 ml-7">
        Ends the current session and relaunches with these settings
      </p>
    </div>
  );
}
