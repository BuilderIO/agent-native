import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/toolkit/ui/radio-group";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useRef, useState } from "react";

import {
  THEME_SETTINGS_SECTION,
  useThemePreference,
  type ThemePreference,
} from "@/components/shell/theme-preference";
import { AppSettingsSections } from "@/skins/app-settings-sections";

import type {
  EditorPreferences,
  EditorPreferencesPatch,
} from "../../../shared/editor-preferences";
import { useAnalyticsAccountPreferencesSections } from "./useAnalyticsAccountPreferencesSections";

const themeOptions = [
  { value: "system", icon: IconDeviceDesktop },
  { value: "light", icon: IconSun },
  { value: "dark", icon: IconMoon },
] as const;

function AnalyticsThemeSettings() {
  const t = useT();
  const { preference, setPreference, systemTheme } = useThemePreference();
  const labels: Record<ThemePreference, string> = {
    system: t("themePreferences.system", {
      theme: t(`themePreferences.${systemTheme}`),
    }),
    light: t("themePreferences.light"),
    dark: t("themePreferences.dark"),
  };
  return (
    <section id={THEME_SETTINGS_SECTION} className="space-y-3">
      <h2
        className="text-sm font-semibold"
        id={`${THEME_SETTINGS_SECTION}-title`}
      >
        {t("analytics.shell.theme")}
      </h2>
      <RadioGroup
        aria-labelledby={`${THEME_SETTINGS_SECTION}-title`}
        className="sm:grid-cols-3"
        value={preference}
        onValueChange={(value) => setPreference(value as ThemePreference)}
      >
        {themeOptions.map(({ value, icon: Icon }) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-4 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem value={value} />
            <Icon size={16} aria-hidden="true" />
            <span className="text-sm">{labels[value]}</span>
          </label>
        ))}
      </RadioGroup>
    </section>
  );
}

export function AnalyticsAccountPreferencesPage() {
  const t = useT();
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {t("accountPreferences.description")}
      </p>
      <AnalyticsAccountPreferences />
      <AnalyticsThemeSettings />
    </div>
  );
}

export function AnalyticsAccountPreferences() {
  const t = useT();
  const label = (name: string) => t(`accountPreferences.${name}`);
  const { session } = useSession();
  const email = session?.email.toLowerCase();
  const active = useRef<object | null>(null);
  const revision = useRef(0);
  const identity = useRef({ email, generation: 0 });
  const acknowledged = useRef<{ generation: number; revision: number } | null>(
    null,
  );
  if (identity.current.email !== email) {
    identity.current = { email, generation: identity.current.generation + 1 };
    active.current = null;
    acknowledged.current = null;
  }
  const generation = identity.current.generation;
  const query = useActionQuery<EditorPreferences>(
    "get-editor-preferences",
    {},
    {
      enabled: !!email,
      queryKeyScope: [email],
      refetchOnMount: "always",
      staleTime: 0,
      onRequestStart: () => acknowledged.current,
      onServerResult: (_result, { requestContext }) => {
        if (
          requestContext &&
          requestContext === acknowledged.current &&
          identity.current.generation === generation &&
          acknowledged.current.revision === revision.current
        ) {
          acknowledged.current = null;
          setDraft(null);
        }
      },
    },
  );
  const save = useActionMutation<EditorPreferences, EditorPreferencesPatch>(
    "set-editor-preferences",
  );
  const [draft, setDraft] = useState<
    (EditorPreferences & { generation: number }) | null
  >(null);
  const [saveErrorGeneration, setSaveErrorGeneration] = useState<number | null>(
    null,
  );
  const [pendingGeneration, setPendingGeneration] = useState<number | null>(
    null,
  );
  const value = email
    ? draft?.generation === generation
      ? draft
      : query.data
    : undefined;
  const set = async (patch: EditorPreferencesPatch) => {
    if (!value || !email || active.current) return;
    const transaction = {};
    const previousDraft = draft?.generation === generation ? draft : null;
    revision.current += 1;
    active.current = transaction;
    setPendingGeneration(generation);
    const isCurrent = () =>
      active.current === transaction &&
      identity.current.generation === generation;
    setDraft({
      lineNumbers: patch.lineNumbers ?? value.lineNumbers,
      fullWidthCells: patch.fullWidthCells ?? value.fullWidthCells,
      vim: patch.vim ?? value.vim,
      generation,
    });
    setSaveErrorGeneration(null);
    try {
      const result = await save.mutateAsync(patch);
      if (!isCurrent()) return;
      setDraft({ ...result, generation });
      acknowledged.current = { generation, revision: revision.current };
      await query.refetch();
    } catch {
      if (isCurrent()) {
        setDraft(previousDraft);
        if (previousDraft)
          acknowledged.current = { generation, revision: revision.current };
        setSaveErrorGeneration(generation);
      }
    } finally {
      if (isCurrent()) {
        active.current = null;
        setPendingGeneration(null);
      }
    }
  };
  const retry = async () => {
    await query.refetch();
  };
  return (
    <div className="space-y-8">
      <AppSettingsSections
        sections={useAnalyticsAccountPreferencesSections()}
        hints={{ frame: "group" }}
      />
      <AppSettingsSections
        sections={[
          {
            id: "editor-behavior",
            label: t("editorPreferences.behavior"),
            state:
              query.isLoading || (!query.isFetchedAfterMount && !query.isError)
                ? { status: "loading", label: t("editorPreferences.behavior") }
                : query.isError || !value
                  ? {
                      status: "error",
                      message: t("editorPreferences.loadFailed"),
                      retry: () => void retry(),
                      retryLabel: t("editorPreferences.retry"),
                    }
                  : { status: "ready" },
            rows: value
              ? [
                  {
                    id: "settings.preferences.full-width-cells",
                    kind: "toggle",
                    label: t("editorPreferences.fullWidthCells"),
                    binding: {
                      value: value.fullWidthCells,
                      set: (fullWidthCells) => set({ fullWidthCells }),
                      pending: pendingGeneration === generation,
                    },
                  },
                  {
                    id: "settings.preferences.line-numbers",
                    kind: "toggle",
                    label: t("editorPreferences.lineNumbers"),
                    binding: {
                      value: value.lineNumbers,
                      set: (lineNumbers) => set({ lineNumbers }),
                      pending: pendingGeneration === generation,
                    },
                  },
                  {
                    id: "settings.preferences.vim",
                    kind: "toggle",
                    label: t("editorPreferences.vimKeyBindings"),
                    binding: {
                      value: value.vim === true,
                      set: (vim) => set({ vim }),
                      pending: pendingGeneration === generation,
                    },
                  },
                ]
              : [],
          },
        ]}
        hints={{ frame: "group" }}
      />
      {saveErrorGeneration === generation && email ? (
        <p role="alert">{t("editorPreferences.saveFailed")}</p>
      ) : null}
    </div>
  );
}
