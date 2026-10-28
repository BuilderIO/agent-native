import { useT } from "@agent-native/core/client/i18n";
import { useThemeFamily, type ThemeFamily } from "@agent-native/core/client/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useState } from "react";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

export function ThemeFamilySettings() {
  const t = useT();
  const { family, status, isForcedByUrl, setFamily } = useThemeFamily();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  async function changeFamily(value: string) {
    if (value !== "agent-native" && value !== "original") return;
    if (value === family) return;

    setSaving(true);
    setSaveFailed(false);
    try {
      await setFamily(value as ThemeFamily);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full sm:w-56">
      <Select
        value={family}
        onValueChange={(value) => void changeFamily(value)}
        disabled={saving || status === "loading" || isForcedByUrl}
      >
        <SelectTrigger aria-label={t(key("themeFamily"))}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="agent-native">
            {t(key("themeFamilyAgentNative"))}
          </SelectItem>
          <SelectItem value="original">
            {t(key("themeFamilyOriginal"))}
          </SelectItem>
        </SelectContent>
      </Select>
      {saveFailed || status === "error" ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {t(key("themeFamilySaveError"))}
        </p>
      ) : null}
    </div>
  );
}
