import { Redirect } from "expo-router";

/**
 * Handles the agentnative://oauth-complete deep link after Google OAuth.
 * Simply redirects back to the main tabs.
 */
export default function OAuthComplete() {
  return <Redirect href="/(tabs)" />;
}
