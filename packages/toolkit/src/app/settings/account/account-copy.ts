import type {
  PasswordValidationError,
  TwoFactorError,
  TwoFactorErrorFallback,
} from "./account-hooks.js";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function profileInitials(name: string): string {
  return (
    name
      .split(/[ @._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

const TWO_FACTOR_FALLBACK_KEYS: Record<TwoFactorErrorFallback, string> = {
  load: "settings.twoFactorLoadError",
  setup: "settings.twoFactorSetupError",
  code: "settings.twoFactorCodeError",
  disable: "settings.twoFactorDisableError",
};

export function twoFactorErrorText(t: Translate, error: TwoFactorError) {
  return error.message ?? t(TWO_FACTOR_FALLBACK_KEYS[error.fallback]);
}

export function passwordErrorText(
  t: Translate,
  form: {
    validationError: PasswordValidationError | null;
    saveFailed: boolean;
  },
): string | undefined {
  if (form.validationError === "length") return t("settings.passwordMinLength");
  if (form.validationError === "mismatch")
    return t("settings.passwordMismatch");
  return form.saveFailed ? t("settings.passwordSaveError") : undefined;
}
