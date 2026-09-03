import {
  registerNativeResourceCaptureAdapter,
  setupCreativeContext,
} from "@agent-native/creative-context/server";

import { nativeDashboardCreativeContextAdapter } from "../lib/native-creative-context.js";

registerNativeResourceCaptureAdapter(nativeDashboardCreativeContextAdapter);

export default setupCreativeContext({ appId: "analytics" });
