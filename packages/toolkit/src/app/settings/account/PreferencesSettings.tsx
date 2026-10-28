import { injectedAgentNativeConfig } from "@agent-native/core/client/app-config";
import { useOptionalLocale, useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import { useEffect, useState } from "react";

import { LanguagePicker } from "../../shared/index.js";
import { canShowThemeFamilySwitcher } from "../../shared/is-builder-io-employee.js";
import { SchedulingTimezoneField } from "../SchedulingTimezoneField.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
import { VoiceChatSettings } from "../VoiceChatSettings.js";
import { VoiceTranscriptionSection } from "../VoiceTranscriptionSection.js";
import { ThemeFamilySettings } from "./ThemeFamilySettings.js";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

/**
 * Account › Preferences. Language and timezone share the per-user
 * localization record, so a change here applies in every app.
 */
export function PreferencesSettings() {
  const t = useT();
  const hasLocale = useOptionalLocale() !== null;
  const { session, status } = useSession();
  const [clientReady, setClientReady] = useState(false);
  const languageLabel = t("agentChat.settingsShell.interfaceLanguage");
  const canSwitchTheme = canShowThemeFamilySwitcher({
    clientReady,
    authenticated: status === "authenticated",
    email: session?.email,
    familyCount: injectedAgentNativeConfig().themeFamily?.families.length ?? 1,
  });

  useEffect(() => setClientReady(true), []);

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="language-region" title={t(key("languageAndRegion"))}>
        {hasLocale ? (
          <SettingsRow
            id="interface-language"
            label={languageLabel}
            description={t(key("languageDescription"))}
            control={
              <div className="w-full sm:w-56">
                <LanguagePicker label={languageLabel} size="sm" />
              </div>
            }
          />
        ) : null}
        <SettingsRow
          id="timezone"
          label={t(key("timezone"))}
          description={t(key("timezoneDescription"))}
          control={<SchedulingTimezoneField compact />}
        />
      </SettingsGroup>
      {canSwitchTheme ? (
        <SettingsGroup id="appearance" title={t(key("appearance"))}>
          <SettingsRow
            id="theme-family"
            label={t(key("themeFamily"))}
            control={<ThemeFamilySettings />}
          />
        </SettingsGroup>
      ) : null}
      <SettingsGroup id="voice-input" title={t(key("voiceInput"))}>
        <VoiceTranscriptionSection compact />
      </SettingsGroup>
      <VoiceChatSettings />
    </div>
  );
}
