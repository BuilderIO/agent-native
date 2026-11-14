import { defineNitroPlugin } from "@agent-native/core/server";

import { registerGettingStartedSteps } from "../lib/getting-started.js";

export default defineNitroPlugin(registerGettingStartedSteps);
