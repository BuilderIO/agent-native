import {
  readClientAppState,
  setClientAppState,
} from "@agent-native/core/client/application-state";
import { useT } from "@agent-native/core/client/i18n";
import type { RealtimeVoiceModeSelectSetting } from "@agent-native/toolkit/composer/RealtimeVoiceMode";
import {
  buildRealtimeVoiceSettings,
  createRealtimeVoiceModeCopy,
  listRealtimeVoiceMicrophones,
  normalizeRealtimeVoicePreferences,
  readRealtimeVoiceMicrophoneId,
  REALTIME_VOICE_PREFERENCES_KEY,
  writeRealtimeVoiceMicrophoneId,
  type RealtimeVoiceMicrophone,
  type RealtimeVoicePreferences,
} from "@agent-native/toolkit/composer/useRealtimeVoiceMode";
import { Skeleton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useEffect, useMemo, useState } from "react";

import { SettingsGroup, SettingsRow } from "./SettingsRow.js";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

/**
 * Account › Preferences › Voice chat. Writes the same preferences a voice
 * chat session reads when it starts.
 */
export function VoiceChatSettings() {
  const t = useT();
  const copy = useMemo(() => createRealtimeVoiceModeCopy(t), [t]);
  const [preferences, setPreferences] =
    useState<RealtimeVoicePreferences | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadRequest, setLoadRequest] = useState(0);
  const [microphones, setMicrophones] = useState<RealtimeVoiceMicrophone[]>([]);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState(
    readRealtimeVoiceMicrophoneId,
  );

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    readClientAppState(REALTIME_VOICE_PREFERENCES_KEY).then(
      (stored) => {
        if (!cancelled) {
          setPreferences(normalizeRealtimeVoicePreferences(stored));
        }
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadRequest]);

  useEffect(() => {
    let cancelled = false;
    void listRealtimeVoiceMicrophones(t).then((inputs) => {
      if (!cancelled && inputs) setMicrophones(inputs);
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const savePreferences = (next: RealtimeVoicePreferences) => {
    const previous = preferences;
    setPreferences(next);
    setSaveFailed(false);
    setClientAppState(REALTIME_VOICE_PREFERENCES_KEY, next, {
      requestSource: "realtime-voice",
    }).catch(() => {
      setPreferences(previous);
      setSaveFailed(true);
    });
  };

  // Without microphone permission the browser hides device names; keep a
  // saved device selectable rather than showing an empty picker.
  const knownMicrophones =
    microphoneDeviceId === "default" ||
    microphones.some((microphone) => microphone.deviceId === microphoneDeviceId)
      ? microphones
      : [
          ...microphones,
          {
            deviceId: microphoneDeviceId,
            label: t("agentChat.voiceMode.settings.microphoneNumber", {
              number: microphones.length + 1,
            }),
          },
        ];

  const settings = preferences
    ? buildRealtimeVoiceSettings({
        copy,
        preferences,
        microphones: knownMicrophones,
        microphoneDeviceId,
        onMicrophoneChange: (deviceId) => {
          writeRealtimeVoiceMicrophoneId(deviceId);
          setMicrophoneDeviceId(deviceId);
        },
        onPreferencesChange: savePreferences,
      })
    : null;

  const rows = settings
    ? ([
        ["microphone", settings.microphone],
        ["language", settings.language],
        ["intelligence", settings.intelligence],
        ["voice-style", settings.voiceStyle],
      ] as const)
    : null;

  return (
    <SettingsGroup id="voice-chat" title={t(key("voiceChat"))}>
      {loadFailed ? (
        <SettingsRow
          id="voice-chat-load-error"
          label={<span role="alert">{t(key("voiceChatLoadError"))}</span>}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLoadRequest((current) => current + 1)}
            >
              {t("agentChat.common.retry")}
            </Button>
          }
        />
      ) : rows ? (
        rows.map(([id, setting]) => (
          <SettingsRow
            key={id}
            id={`voice-chat-${id}`}
            label={setting.label}
            control={<VoiceChatSettingSelect setting={setting} />}
          />
        ))
      ) : (
        <SettingsRow
          id="voice-chat-loading"
          label={t(key("voiceChat"))}
          control={
            <Skeleton
              className="h-8 w-44"
              aria-label={t("agentChat.common.loading")}
            />
          }
        />
      )}
      {saveFailed ? (
        <p
          role="alert"
          className="px-5 py-3 text-sm text-[hsl(var(--agent-kit-warning))] sm:px-6"
        >
          {t(key("voiceChatSaveError"))}
        </p>
      ) : null}
    </SettingsGroup>
  );
}

function VoiceChatSettingSelect({
  setting,
}: {
  setting: RealtimeVoiceModeSelectSetting;
}) {
  return (
    <Select value={setting.value} onValueChange={setting.onValueChange}>
      <SelectTrigger size="sm" className="w-44" aria-label={setting.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {setting.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
