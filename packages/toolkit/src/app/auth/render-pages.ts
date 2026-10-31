import type {
  AuthPageProps,
  ResetPasswordPageProps,
} from "@agent-native/core/shared/auth-page-types";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { AuthPage } from "./AuthPage.js";
import { ResetPasswordPage } from "./ResetPasswordPage.js";

export function renderSignInPageMarkup(props: AuthPageProps): string {
  return renderToString(createElement(AuthPage, props));
}

export function renderResetPasswordPageMarkup(
  props: ResetPasswordPageProps,
): string {
  return renderToString(createElement(ResetPasswordPage, props));
}
