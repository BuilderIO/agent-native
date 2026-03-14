import type { HarnessConfig } from "./config";

const STORAGE_KEY_PREFIX = "harness-launch-options";

export interface LaunchSettings {
  options: Record<string, boolean>;
  custom: string;
  activeApp: string;
}

export function defaultSettings(config: HarnessConfig): LaunchSettings {
  return {
    options: Object.fromEntries(
      config.options.map((o) => [o.key, o.defaultValue])
    ),
    custom: "",
    activeApp: "",
  };
}

function storageKey(config: HarnessConfig): string {
  return `${STORAGE_KEY_PREFIX}-${config.command}`;
}

export function loadSettings(config: HarnessConfig): LaunchSettings {
  const defaults = defaultSettings(config);
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey(config)) || "{}"
    );
    return {
      ...defaults,
      ...saved,
      options: { ...defaults.options, ...(saved.options || {}) },
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(config: HarnessConfig, s: LaunchSettings) {
  localStorage.setItem(storageKey(config), JSON.stringify(s));
}

export function settingsToFlags(
  s: LaunchSettings,
  config: HarnessConfig
): string {
  const flags: string[] = [];
  for (const opt of config.options) {
    if (s.options[opt.key]) flags.push(opt.flag);
  }
  const custom = s.custom.trim();
  if (custom) flags.push(custom);
  return flags.join(" ");
}
