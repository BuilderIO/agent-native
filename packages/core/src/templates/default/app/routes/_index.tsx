import { signInLandingLoader } from "@agent-native/core/client/sign-in-landing";
import { getAppConfig, resolveAppHomePath } from "@agent-native/core/server";

import HomePage from "./home";

export function loader() {
  const config = getAppConfig();
  return signInLandingLoader(resolveAppHomePath(config.app, config.workspace));
}

export default HomePage;
