import { useT } from "@agent-native/core/client/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useTheme } from "next-themes";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

const THEME_MODES = [
  { value: "system", labelKey: key("themeSystem") },
  { value: "light", labelKey: key("themeLight") },
  { value: "dark", labelKey: key("themeDark") },
] as const;

type ThemeMode = (typeof THEME_MODES)[number]["value"];

function isThemeMode(value: string | undefined): value is ThemeMode {
  return THEME_MODES.some((mode) => mode.value === value);
}

/** The light, dark or system choice next-themes keeps for this app. */
export function useThemeMode(): {
  mode: ThemeMode | null;
  setMode: (mode: ThemeMode) => void;
} {
  const { theme, setTheme } = useTheme();
  return {
    mode: isThemeMode(theme) ? theme : null,
    setMode: setTheme,
  };
}

export function ThemeModeSettings() {
  const t = useT();
  const { mode, setMode } = useThemeMode();
  if (!mode) return null;

  return (
    <div className="w-full sm:w-56">
      <Select
        value={mode}
        onValueChange={(value) => {
          if (isThemeMode(value)) setMode(value);
        }}
      >
        <SelectTrigger aria-label={t(key("theme"))}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_MODES.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
