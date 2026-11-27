import { injectedAgentNativeConfig } from "@agent-native/core/client/app-config";
import { useOptionalLocale, useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import type { ModelRow } from "@agent-native/design-system/model";
import { useThemeChoice } from "@agent-native/toolkit/app/providers/theme-choice";
import { useEffect, useState } from "react";

import {
  combineFragments,
  ModelSurface,
} from "../../../design-system/parts.js";
import { LanguagePicker } from "../../shared/index.js";
import { canShowThemeFamilySwitcher } from "../../shared/is-builder-io-employee.js";
import { SchedulingTimezoneField } from "../SchedulingTimezoneField.js";
import { VoiceChatSettings } from "../VoiceChatSettings.js";
import { useVoiceTranscriptionRow } from "../VoiceTranscriptionSection.js";
import { ThemeFamilySettings } from "./ThemeFamilySettings.js";
import { ThemeModeSettings } from "./ThemeModeSettings.js";

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
  const { choice: themeChoice } = useThemeChoice();
  const canChooseThemeMode = clientReady && themeChoice !== null;
  const languageLabel = t("agentChat.settingsShell.interfaceLanguage");
  const canSwitchTheme = canShowThemeFamilySwitcher({
    clientReady,
    authenticated: status === "authenticated",
    email: session?.email,
    familyCount: injectedAgentNativeConfig().themeFamily?.families.length ?? 1,
  });

  useEffect(() => setClientReady(true), []);
  const voice = useVoiceTranscriptionRow();

  const groups: ModelRow[] = [
    {
      id: "settings.preferences.language-region",
      part: "settings.group",
      label: t(key("languageAndRegion")),
      anchor: "language-region",
      rows: [
        ...(hasLocale
          ? [
              {
                id: "settings.preferences.language-region.language",
                part: "settings.row",
                kind: "choice",
                label: languageLabel,
                description: t(key("languageDescription")),
                anchor: "interface-language",
                slot: "interface-language",
              } satisfies ModelRow,
            ]
          : []),
        {
          id: "settings.preferences.language-region.timezone",
          part: "settings.row",
          kind: "choice",
          label: t(key("timezone")),
          description: t(key("timezoneDescription")),
          anchor: "timezone",
          slot: "timezone",
        },
      ],
    },
    ...(canChooseThemeMode || canSwitchTheme
      ? [
          {
            id: "settings.preferences.appearance",
            part: "settings.group",
            label: t(key("appearance")),
            anchor: "appearance",
            rows: [
              ...(canChooseThemeMode
                ? [
                    {
                      id: "settings.preferences.appearance.theme",
                      part: "settings.row",
                      kind: "choice",
                      label: t(key("theme")),
                      anchor: "theme",
                      slot: "theme",
                    } satisfies ModelRow,
                  ]
                : []),
              ...(canSwitchTheme
                ? [
                    {
                      id: "settings.preferences.appearance.theme-family",
                      part: "settings.row",
                      kind: "choice",
                      label: t(key("themeFamily")),
                      anchor: "theme-family",
                      slot: "theme-family",
                    } satisfies ModelRow,
                  ]
                : []),
            ],
          } satisfies ModelRow,
        ]
      : []),
    {
      id: "settings.preferences.voice-input",
      part: "settings.group",
      label: t(key("voiceInput")),
      anchor: "voice-input",
      rows: voice.rows,
    },
  ];
  const { actions, slots } = combineFragments([
    {
      rows: [],
      slots: {
        "interface-language": (
          <div className="w-full sm:w-56">
            <LanguagePicker label={languageLabel} size="sm" />
          </div>
        ),
        timezone: <SchedulingTimezoneField compact />,
        theme: <ThemeModeSettings />,
        "theme-family": <ThemeFamilySettings />,
      },
    },
    voice,
  ]);

  return (
    <div className="flex flex-col gap-8">
      <ModelSurface
        model={{ id: "settings", rows: groups }}
        actions={actions}
        slots={slots}
      />
      <VoiceChatSettings />
    </div>
  );
}
