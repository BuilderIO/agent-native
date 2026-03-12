import { type LaunchSettings } from "../lib/settings";

interface SettingsPanelProps {
  settings: LaunchSettings;
  onChange: (s: LaunchSettings) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const update = (patch: Partial<LaunchSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <div className="absolute top-9 right-2 bg-[#0a0a0a] border border-[#222] rounded-lg p-3 z-50 min-w-[300px] shadow-2xl">
      <h3 className="text-[13px] font-semibold text-white/90 mb-2.5">
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
        className="w-full mt-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white/80 font-mono focus:outline-none focus:border-blue-500"
      />
      <p className="text-[11px] text-white/30 mt-1">
        Space-separated flags appended to the command
      </p>
    </div>
  );
}
