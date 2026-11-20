import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { FormSettings, PublicFormResult } from "@shared/form-contract";
import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_SURFACE } from "@/lib/field-surface";

import { sessionIdFor } from "./respond-storage";
import { Frame } from "./states";
import { ThemedSurface } from "./ThemedSurface";

type OpenForm = Extract<PublicFormResult, { state: "open" }>["form"];

export function PasswordGate({
  formId,
  name,
  settings,
  onUnlock,
}: {
  formId: string;
  name: string;
  settings: FormSettings;
  onUnlock: (form: OpenForm, password: string) => void;
}) {
  const t = useT();
  const unlock = useActionMutation("unlock-form");
  const [password, setPassword] = useState("");
  const [refused, setRefused] = useState<"wrong" | "throttled" | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (unlock.isPending) return;
    setRefused(null);
    unlock.mutate(
      { formId, password, sessionId: sessionIdFor(formId) },
      {
        onSuccess: (result) => {
          if (result.state === "open") onUnlock(result.form, password);
          else
            setRefused(
              result.state === "locked" && result.retryAfterSeconds
                ? "throttled"
                : "wrong",
            );
        },
      },
    );
  }

  return (
    <ThemedSurface
      settings={settings}
      withCss
      className="min-h-[calc(100vh/var(--fs-scale,1))]"
    >
      <Frame>
        <form noValidate onSubmit={submit} className="forms-page">
          <h1 className="forms-title pb-6 text-[40px] leading-[48px] font-extrabold">
            {name}
          </h1>
          <p className="pb-4 text-base">{t("forms.collection.gateIntro")}</p>
          <div className="forms-question">
            <label
              htmlFor="forms-gate-password"
              className="forms-question-title block pb-2 text-base font-semibold"
            >
              {t("forms.collection.gatePassword")}
            </label>
            {/* type=text with masking: a password input has no textbox role. */}
            <input
              id="forms-gate-password"
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={`forms-input [-webkit-text-security:disc] h-9 w-80 max-w-full ${FIELD_SURFACE} px-2.5 text-base text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring`}
              value={password}
              aria-invalid={refused === "wrong"}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {refused ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {refused === "throttled"
                ? t("forms.collection.gateThrottled")
                : t("forms.collection.gateWrong")}
            </p>
          ) : null}
          <div className="forms-actions my-[10px]">
            <Button
              type="submit"
              disabled={unlock.isPending}
              className="forms-button h-9 gap-1.5 rounded-[var(--fs-button-radius)] bg-[var(--fs-button-bg)] px-[13.5px] py-0 text-[15px] font-normal text-[var(--fs-button-text)] hover:bg-[var(--fs-button-bg)] hover:opacity-85"
            >
              <span className="font-semibold">
                {t("forms.collection.gateContinue")}
              </span>
              {unlock.isPending ? (
                <IconLoader2 className="size-[18px] animate-spin" />
              ) : (
                <IconArrowRight className="size-4" />
              )}
            </Button>
          </div>
        </form>
      </Frame>
    </ThemedSurface>
  );
}
