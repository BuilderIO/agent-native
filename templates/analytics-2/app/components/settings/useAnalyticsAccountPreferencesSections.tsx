import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { SettingsSectionDefinition } from "@agent-native/toolkit/app/settings";
import { useEffect, useState } from "react";

import type {
  PersonalPreferences,
  PersonalPreferencesUpdate,
} from "../../../shared/personal-preferences";

/**
 * The personal instructions row: read-only until Edit is pressed, then a text
 * area with Save. The model owns the edit: it holds the content and revision
 * the edit started from, so a save after someone else's change is refused
 * instead of overwriting it, and it ends the edit when the signed-in owner
 * changes.
 */
export function useAnalyticsAccountPreferencesSections(): SettingsSectionDefinition[] {
  const t = useT();
  const label = (name: string) => t(`accountPreferences.${name}`);
  const query = useActionQuery<PersonalPreferences>(
    "get-personal-preferences",
    {},
  );
  const save = useActionMutation<
    PersonalPreferences,
    PersonalPreferencesUpdate
  >("set-personal-preferences");
  const [draft, setDraft] = useState<PersonalPreferences | null>(null);
  const [saved, setSaved] = useState<PersonalPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSaved(null), [query.data]);
  useEffect(() => {
    if (draft && query.data && draft.owner !== query.data.owner) {
      setDraft(null);
      setError(null);
    }
  }, [query.data?.owner, draft?.owner]);
  const current =
    saved?.owner === query.data?.owner ? (saved ?? query.data) : query.data;
  const visibleDraft = draft?.owner === current?.owner ? draft : null;
  const submit = async (content: string) => {
    if (!visibleDraft) return;
    setError(null);
    try {
      const result = await save.mutateAsync({
        content,
        expectedOwner: visibleDraft.owner,
        expectedRevision: visibleDraft.revision,
      });
      setSaved(result);
      setDraft(null);
      void query.refetch();
    } catch (failure) {
      setError(actionErrorMessage(failure) ?? label("saveFailed"));
      // The edit stays open with what was typed.
      throw failure;
    }
  };
  return [
    {
      id: "agent-personalization",
      label: label("personalization"),
      rows: [
        {
          id: "settings.preferences.personal-preferences",
          kind: "textarea",
          label: label("personal"),
          description: (
            <>
              {label("help")}{" "}
              <a
                className="underline"
                href="https://www.agent-native.com/docs"
                target="_blank"
                rel="noreferrer"
              >
                {label("learnMore")}
              </a>
            </>
          ),
          mode: "view",
          editLabel: label("edit"),
          saveLabel: label("save"),
          emptyValue: {
            label: label("placeholder"),
            description: label("applies"),
          },
          editing: visibleDraft !== null,
          setEditing: (editing) => {
            if (!editing) {
              setDraft(null);
            } else if (current) {
              setDraft(current);
              setError(null);
            }
          },
          // While an edit is open the value is the one it started from, so a
          // change that arrives in the background does not move the text.
          binding: {
            value: visibleDraft?.content ?? current?.content ?? "",
            set: submit,
            actionName: "set-personal-preferences",
            pending: save.isPending,
            commit: "explicit",
          },
          ...(query.isLoading
            ? { state: { status: "loading" as const, label: label("loading") } }
            : query.isError || !current
              ? {
                  state: {
                    status: "error" as const,
                    message: label("loadFailed"),
                    retry: () => void query.refetch(),
                    retryLabel: label("retry"),
                  },
                }
              : {}),
          ...(error ? { error } : {}),
        },
      ],
    },
  ];
}
