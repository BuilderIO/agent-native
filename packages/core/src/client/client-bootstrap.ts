import { ensureEmbedAuthFetchInterceptor } from "./embed-auth.js";
import { installRouteChunkRecovery } from "./route-chunk-recovery.js";

export function initializeAgentNativeClient(): void {
  ensureEmbedAuthFetchInterceptor();
  installRouteChunkRecovery();
}
