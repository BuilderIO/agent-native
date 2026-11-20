import { useT } from "@agent-native/core/client/i18n";

import { inputClass } from "./answer-fields";

export type VerifyReason =
  | "verify"
  | "wrong_code"
  | "code_expired"
  | "code_limit"
  | "verify_unavailable";

export type VerifyState = { email: string; reason: VerifyReason };

const ERROR_KEYS = {
  wrong_code: "forms.notify.codeWrong",
  code_expired: "forms.notify.codeExpired",
  code_limit: "forms.notify.codeLimit",
  verify_unavailable: "forms.notify.codeUnavailable",
} as const;

/** The code box shown after Submit on a form with a verified email question. */
export function VerifyEmailStep({
  state,
  code,
  disabled,
  onCode,
  onResend,
}: {
  state: VerifyState;
  code: string;
  disabled: boolean;
  onCode: (code: string) => void;
  onResend: () => void;
}) {
  const t = useT();
  return (
    <div className="forms-question mb-4">
      {state.reason === "verify_unavailable" ? null : (
        <p className="pb-2.5 text-base">
          {t("forms.notify.codeSent", { email: state.email })}
        </p>
      )}
      <input
        aria-label={t("forms.notify.codeLabel")}
        aria-invalid={state.reason === "verify" ? undefined : true}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className={inputClass}
        value={code}
        onChange={(event) => onCode(event.target.value)}
      />
      {state.reason === "verify" ? null : (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t(ERROR_KEYS[state.reason])}
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        className="mt-3 block text-sm underline"
        onClick={onResend}
      >
        {t("forms.notify.resend")}
      </button>
    </div>
  );
}
