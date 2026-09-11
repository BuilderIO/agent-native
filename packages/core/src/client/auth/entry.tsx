import { hydrateRoot } from "react-dom/client";

import { AuthPage, type AuthPageProps } from "./AuthPage.js";
import {
  ResetPasswordPage,
  type ResetPasswordPageProps,
} from "./ResetPasswordPage.js";

const root = document.getElementById("agent-native-auth-root");
const data = document.getElementById("agent-native-auth-data");

if (root && data) {
  const props = JSON.parse(data.textContent ?? "{}") as
    | AuthPageProps
    | ResetPasswordPageProps;
  if ("pageType" in props && props.pageType === "reset-password") {
    hydrateRoot(root, <ResetPasswordPage {...props} />);
  } else {
    hydrateRoot(root, <AuthPage {...(props as AuthPageProps)} />);
  }
}
