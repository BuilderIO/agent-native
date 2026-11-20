import {
  useActionMutation,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { LocaleMessages } from "@agent-native/core/client/i18n";
import type { PublicFormResult } from "@shared/form-contract";
import { useEffect, useState, type ReactNode } from "react";

import { i18nCatalog, loadLocaleMessages, resolveShippedLocale } from "@/i18n";

import { FormRunner } from "./FormRunner";
import { PasswordGate } from "./PasswordGate";
import {
  rememberPassword,
  respondentId,
  sessionIdFor,
} from "./respond-storage";
import {
  ClosedState,
  FormSkeleton,
  LoadErrorState,
  UnavailableState,
} from "./states";
import { useTrackEvents } from "./track-events";

const visited = new Set<string>();

export function PublicForm({ formId }: { formId: string }) {
  const { data, error, isLoading, refetch } = useActionQuery(
    "get-public-form",
    { formId },
  );
  const { session } = useSession();
  const [unlocked, setUnlocked] = useState<{
    form: Extract<PublicFormResult, { state: "open" }>["form"];
    password: string;
  } | null>(null);
  const track = useTrackEvents();
  const recordEvent = useActionMutation("record-form-event");
  const open = data?.state === "open";
  const record = recordEvent.mutate;

  useEffect(() => {
    if (!track || !open || visited.has(formId)) return;
    visited.add(formId);
    record({
      formId,
      sessionId: sessionIdFor(formId),
      type: "visit",
      data: { respondentId: respondentId() },
    });
  }, [track, open, formId, record]);

  if (isLoading) return <FormSkeleton />;
  if (error || !data) return <LoadErrorState onRetry={() => void refetch()} />;
  if (data.state === "closed") return <ClosedState message={data.message} />;
  if (data.state === "unavailable")
    return <UnavailableState signedIn={Boolean(session)} />;
  if (data.state === "locked") {
    if (!unlocked)
      return (
        <FormLanguage language={data.settings.language}>
          <PasswordGate
            formId={formId}
            name={data.name}
            settings={data.settings}
            onUnlock={(form, password) => {
              rememberPassword(formId, password);
              setUnlocked({ form, password });
            }}
          />
        </FormLanguage>
      );
    return (
      <FormLanguage language={unlocked.form.settings.language}>
        <FormRunner
          mode="live"
          formId={formId}
          blocks={unlocked.form.blocks}
          settings={unlocked.form.settings}
          password={unlocked.password}
        />
      </FormLanguage>
    );
  }
  return (
    <FormLanguage language={data.form.settings.language}>
      <FormRunner
        mode="live"
        formId={formId}
        blocks={data.form.blocks}
        settings={data.form.settings}
      />
    </FormLanguage>
  );
}

/**
 * A published form carries its own language in settings, and that is the language
 * a respondent reads it in whatever the author's interface language is. The
 * provider is scoped to the respondent surface and never persists a preference,
 * so it cannot change the author's own app language.
 */
export function FormLanguage({
  language,
  children,
}: {
  language?: string | undefined;
  children: ReactNode;
}) {
  const locale = language?.trim() || undefined;
  // The settings page stores a language ("de"), the provider wants the locale it
  // ships ("de-DE"); both name the same language for a respondent.
  const shipped = locale ? resolveShippedLocale(locale) : null;
  // The messages for that locale arrive with a tiny chunk of their own; until they do
  // (or when this build ships none) the form keeps the interface language.
  const [messages, setMessages] = useState<LocaleMessages | null>(null);
  useEffect(() => {
    if (!locale) return;
    let alive = true;
    void loadLocaleMessages(locale).then((loaded) => {
      if (alive && loaded) setMessages(loaded);
    });
    return () => {
      alive = false;
    };
  }, [locale]);
  if (!locale || !shipped) return <>{children}</>;
  return (
    <AgentNativeI18nProvider
      catalog={i18nCatalog}
      initialLocale={shipped}
      // The provider resolves its locale again from the preference once it mounts, so a
      // surface that carries its own language also pins the preference; otherwise the
      // browser's language (the author's) silently wins and the form reads in English.
      initialPreference={shipped}
      {...(messages ? { initialMessages: messages } : {})}
      persistPreference={false}
    >
      {children}
    </AgentNativeI18nProvider>
  );
}
