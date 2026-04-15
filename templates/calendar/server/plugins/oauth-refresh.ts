import { startGoogleTokenRefreshLoop } from "@agent-native/core/oauth-tokens";

export default () => {
  startGoogleTokenRefreshLoop();
};
