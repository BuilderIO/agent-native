import { useT } from "@agent-native/core/client/i18n";
import {
  isThemeChoice,
  useThemeChoice,
  type ThemeChoice,
} from "@agent-native/toolkit/app/providers/theme-choice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

const THEME_MODES: ReadonlyArray<{ value: ThemeChoice; labelKey: string }> = [
  { value: "system", labelKey: key("themeSystem") },
  { value: "light", labelKey: key("themeLight") },
  { value: "dark", labelKey: key("themeDark") },
];

export function ThemeModeSettings() {
  const t = useT();
  const { choice, setChoice } = useThemeChoice();
  if (!choice) return null;

  return (
    <div className="w-full sm:w-56">
      <Select
        value={choice}
        onValueChange={(value) => {
          if (isThemeChoice(value)) setChoice(value);
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
