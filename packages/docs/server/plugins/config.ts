import { defineAppConfig } from "@agent-native/core/server";

// The public homepage is the site's root; there is no private /home route.
export default defineAppConfig({ app: { homePath: "/" } });
