import { useOptionalLocale, useT } from "../../../i18n.js";
import { LanguagePicker } from "../../../LanguagePicker.js";
import { AgentSettingsContent } from "../../SettingsPanel.js";
import { SettingsGroup, SettingsRow } from "../../SettingsRow.js";

export default function PreferencesSettingsPage() {
  const t = useT();
  const hasLocale = useOptionalLocale() !== null;
  const languageLabel = t("agentChat.settingsShell.interfaceLanguage");
  return (
    <div className="flex flex-col gap-8">
      {hasLocale ? (
        <SettingsGroup id="language">
          <SettingsRow
            id="interface-language"
            label={languageLabel}
            control={
              <div className="w-56">
                <LanguagePicker label={languageLabel} />
              </div>
            }
          />
        </SettingsGroup>
      ) : null}
      <AgentSettingsContent sections={["voice"]} />
    </div>
  );
}
