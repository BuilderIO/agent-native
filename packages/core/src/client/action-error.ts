import type { i18n as I18nInstance } from "i18next";
import { getI18n } from "react-i18next";

import { ACTION_ERROR_MESSAGES } from "../localization/action-error-messages.js";

/** Diagnostics stay in cause; message is always catalog copy safe for the UI. */
export class ActionError extends Error {
  readonly userMessage: string;
  readonly actionMessage: string;
  readonly code: string;
  readonly catalogMessage: string | undefined;
  readonly status?: number;
  readonly errorCode?: string;
  readonly timedOut?: boolean;
  readonly retryAfterMs?: number;
  readonly requestId?: string;

  constructor(cause: unknown, instance?: I18nInstance) {
    const fields =
      cause && typeof cause === "object"
        ? (cause as {
            code?: unknown;
            errorCode?: unknown;
            status?: unknown;
            timedOut?: unknown;
          })
        : {};
    const code =
      typeof fields.errorCode === "string"
        ? fields.errorCode
        : typeof fields.code === "string"
          ? fields.code
          : fields.timedOut === true
            ? "timeout"
            : fields.status === undefined
              ? "network_error"
              : "request_failed";
    // react-i18next leaves this unset until the first provider initializes.
    const i18n =
      instance ?? (getI18n() as ReturnType<typeof getI18n> | undefined);
    const fallback =
      i18n?.t("actionErrors.failed", {
        defaultValue: ACTION_ERROR_MESSAGES["en-US"].failed,
      }) ?? ACTION_ERROR_MESSAGES["en-US"].failed;
    const specific = i18n?.t(`actionErrors.codes.${code}`, {
      defaultValue: "",
    });
    const catalogMessage =
      typeof specific === "string" && specific ? specific : undefined;
    const userMessage = catalogMessage ?? fallback;
    super(userMessage, { cause });
    Object.assign(this, cause);
    this.name = "ActionError";
    this.message = userMessage;
    this.userMessage = userMessage;
    this.actionMessage = userMessage;
    this.code = code;
    this.catalogMessage = catalogMessage;
  }
}
