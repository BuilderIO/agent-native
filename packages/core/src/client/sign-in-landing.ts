import { redirectDocument } from "react-router";

import { SIGN_IN_ENTRY_PATH } from "../shared/sign-in-journey.js";
import { appPath } from "./api-path.js";

export function signInLandingLoader() {
  return redirectDocument(appPath(SIGN_IN_ENTRY_PATH));
}
