import { ensureBackendFetchInterceptor } from "./backend-fetch.js";
import { ensureEmbedAuthFetchInterceptor } from "./embed-auth.js";
import { startRecorder } from "./recorder.js";
import { installRouteChunkRecovery } from "./route-chunk-recovery.js";

export function initializeAgentNativeClient(): void {
  ensureEmbedAuthFetchInterceptor();
  // Installed second so it wraps embed auth: requests reach the embed
  // interceptor already pointed at the app server.
  ensureBackendFetchInterceptor();
  installRouteChunkRecovery();
  startRecorder();
}
