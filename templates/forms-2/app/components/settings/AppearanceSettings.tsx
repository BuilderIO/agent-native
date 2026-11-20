import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsRow,
  ThemeFamilySettings,
} from "@agent-native/toolkit/app/settings";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

/** The app's own colours are the default; this is the way to the Agent-Native family. */
export function AppearanceSettings() {
  const t = useT();
  return (
    <SettingsGroup id="appearance" title={t(key("appearance"))}>
      <SettingsRow
        id="theme-family"
        label={t(key("themeFamily"))}
        control={<ThemeFamilySettings />}
      />
    </SettingsGroup>
  );
}
