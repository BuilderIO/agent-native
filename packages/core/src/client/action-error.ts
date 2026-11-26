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
            : "request_failed";

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

/** Marks fetch/body failures; a known HTTP refusal retains its status and classification. */
export function actionTransportError(
  cause: unknown,
  response?: Pick<Response, "status" | "ok" | "headers">,
): Error {
  const error = Object.assign(
    new Error(cause instanceof Error ? cause.message : String(cause), {
      cause,
    }),
    { code: response && !response.ok ? "request_failed" : "network_error" },
  );
  if (response) {
    Object.assign(error, { status: response.status });
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    if (Number.isInteger(seconds) && seconds > 0 && seconds <= 300)
      Object.assign(error, { retryAfterMs: seconds * 1000 });
    const requestId = response.headers.get("x-agent-native-request-id");
    if (requestId) Object.assign(error, { requestId });
  }
  if (cause instanceof Error && cause.name === "AbortError")
    error.name = "AbortError";
  return error;
}
