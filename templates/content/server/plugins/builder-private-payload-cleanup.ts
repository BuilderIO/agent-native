import {
  defineNitroPlugin,
  registerRecurringSweepHandler,
} from "@agent-native/core/server";

import { drainBuilderPrivatePayloadCleanup } from "../../actions/_builder-cms-blob-custody.js";

export const BUILDER_PRIVATE_PAYLOAD_CLEANUP_SWEEP_ID =
  "content-builder-private-payload-cleanup";

export function registerBuilderPrivatePayloadCleanupSweep() {
  return registerRecurringSweepHandler(
    BUILDER_PRIVATE_PAYLOAD_CLEANUP_SWEEP_ID,
    async ({ deadlineAt, signal }) => {
      await drainBuilderPrivatePayloadCleanup({ deadlineAt, signal });
    },
  );
}

export default defineNitroPlugin(() => {
  registerBuilderPrivatePayloadCleanupSweep();
});
