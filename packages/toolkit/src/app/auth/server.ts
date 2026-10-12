import { createAuthPlugin, type AuthOptions } from "@agent-native/core/server";
import type {
  AuthPageProps,
  ResetPasswordPageProps,
} from "@agent-native/core/shared/auth-page-types";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { AuthPage } from "./AuthPage.js";
import { ResetPasswordPage } from "./ResetPasswordPage.js";

export function renderAuthPage(props: AuthPageProps): string {
  return renderToString(createElement(AuthPage, props));
}

export function renderAuthResetPasswordPage(
  props: ResetPasswordPageProps,
): string {
  return renderToString(createElement(ResetPasswordPage, props));
}

export function createToolkitAuthPlugin(options: AuthOptions = {}) {
  return createAuthPlugin({
    ...options,
    renderSignInPage: options.renderSignInPage ?? renderAuthPage,
    renderResetPasswordPage:
      options.renderResetPasswordPage ?? renderAuthResetPasswordPage,
  });
}
