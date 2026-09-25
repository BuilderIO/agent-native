import { useOptionalLocale, useT } from "../../i18n.js";
import { LanguagePicker } from "../../LanguagePicker.js";
import { SchedulingTimezoneField } from "../SchedulingTimezoneField.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
import { VoiceTranscriptionSection } from "../VoiceTranscriptionSection.js";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

/**
 * Account › Preferences. Language and timezone share the per-user
 * localization record, so a change here applies in every app.
 */
export function PreferencesSettings() {
  const t = useT();
  const hasLocale = useOptionalLocale() !== null;
  const languageLabel = t("agentChat.settingsShell.interfaceLanguage");
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
                <LanguagePicker label={languageLabel} />
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
      <SettingsGroup id="voice-input" title={t(key("voiceInput"))}>
        <VoiceTranscriptionSection compact />
      </SettingsGroup>
    </div>
  );
}
