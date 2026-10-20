import type { SettingsPageSearchEntry } from "../shell/registry.js";

// Anchors are the row ids on the Profile, Preferences, and Security pages.
// Keywords stay English so English terms match in every locale.

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

export const PROFILE_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "profile-photo",
    labelKey: key("profilePhoto"),
    keywords: "profile photo avatar picture image",
    anchor: "profile-photo",
  },
  {
    id: "profile-name",
    labelKey: key("name"),
    keywords: "name display name full name",
    anchor: "profile-name",
  },
  {
    id: "email",
    labelKey: key("email"),
    keywords: "email address change email",
    anchor: "email",
  },
];

export const PREFERENCES_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "interface-language",
    labelKey: "agentChat.settingsShell.interfaceLanguage",
    keywords: "language locale translation",
    anchor: "interface-language",
  },
  {
    id: "timezone",
    labelKey: key("timezone"),
    keywords: "timezone time zone clock schedule scheduling",
    anchor: "timezone",
  },
  {
    id: "voice",
    labelKey: "agentChat.settingsShell.search.voiceTranscription",
    keywords:
      "voice transcription speech dictation microphone speech to text mac native google realtime batch",
    anchor: "voice",
  },
];

export const SECURITY_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "password",
    labelKey: key("password"),
    keywords: "password sign in add password change password",
    anchor: "password",
  },
  {
    id: "two-factor",
    labelKey: key("twoFactor"),
    keywords: "two-factor 2fa mfa authenticator totp",
    anchor: "two-factor",
  },
  {
    id: "data-copy",
    labelKey: key("requestCopyLabel"),
    keywords: "privacy data export download copy access gdpr ccpa",
    anchor: "data-copy",
  },
  {
    id: "data-deletion",
    labelKey: key("requestDeletionLabel"),
    keywords: "privacy data delete deletion erase gdpr ccpa",
    anchor: "data-deletion",
  },
];
