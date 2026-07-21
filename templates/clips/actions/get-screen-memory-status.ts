import { defineAction } from "@agent-native/core";
import { readScreenMemoryStatus } from "@agent-native/core/mcp-client";
import { z } from "zod";

export default defineAction({
  description:
    "Check local Clips Screen Memory status for this machine: enabled/paused state, local metadata files, and capture recency. Screen Memory is disabled by default, local-only, and does not expose media bytes or images.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const status = await readScreenMemoryStatus();
    return {
      feature: status.feature,
      localOnly: status.localOnly,
      enabled: status.enabled,
      paused: status.paused,
      state: status.state,
      captureMode: status.config.captureMode,
      retentionHours: status.config.retentionHours,
      captureCount: status.captureCount,
      storageBytes: status.storageBytes,
      oldestCaptureAt: status.oldestCaptureAt,
      newestCaptureAt: status.newestCaptureAt,
      note: status.note,
    };
  },
});
