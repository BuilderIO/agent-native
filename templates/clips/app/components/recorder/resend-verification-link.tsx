import { resendVerificationEmail } from "@agent-native/core/client/auth/resend-verification-email";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { Spinner } from "@/components/ui/spinner";

/** Lets an unverified account ask for another verification email in place. */
export function ResendVerificationLink({ email }: { email: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );

  if (state === "sent") {
    return (
      <p role="status" className="text-center text-xs text-muted-foreground">
        {t("freeClips.verificationSent")}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={state === "sending"}
        aria-busy={state === "sending"}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground disabled:opacity-60"
        onClick={() => {
          setState("sending");
          resendVerificationEmail(email).then(
            () => setState("sent"),
            () => setState("failed"),
          );
        }}
      >
        {state === "sending" ? (
          <Spinner className="size-3" aria-hidden />
        ) : null}
        {t("freeClips.resendVerification")}
      </button>
      {state === "failed" ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {t("freeClips.verificationFailed")}
        </p>
      ) : null}
    </div>
  );
}
