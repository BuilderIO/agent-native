const STORAGE_KEY = "harness-launch-options";

export interface LaunchSettings {
  skipPermissions: boolean;
  resume: boolean;
  verbose: boolean;
  custom: string;
}

const defaults: LaunchSettings = {
  skipPermissions: true,
  resume: false,
  verbose: false,
  custom: "",
};

export function loadSettings(): LaunchSettings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: LaunchSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function settingsToFlags(s: LaunchSettings): string {
  const flags: string[] = [];
  if (s.skipPermissions) flags.push("--dangerously-skip-permissions");
  if (s.resume) flags.push("--resume");
  if (s.verbose) flags.push("--verbose");
  const custom = s.custom.trim();
  if (custom) flags.push(custom);
  return flags.join(" ");
}
