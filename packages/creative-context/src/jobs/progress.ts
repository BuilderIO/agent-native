import {
  completeRun,
  getRun,
  startRun,
  updateRunProgress,
} from "@agent-native/core/progress";

import type { ContextImportProgressReporter } from "./types.js";

export const contextImportProgressReporter: ContextImportProgressReporter = {
  async start(input) {
    const existing = await getRun(input.id, input.owner);
    if (existing) {
      await updateRunProgress(input.id, input.owner, {
        status: "running",
        percent: null,
        step: input.step,
        metadata: input.metadata,
      });
      return;
    }
    await startRun(input);
  },
  async update(input) {
    await updateRunProgress(input.id, input.owner, {
      percent: input.percent,
      step: input.step,
      metadata: input.metadata,
    });
  },
  async complete(input) {
    await completeRun(input.id, input.owner, input.status, {
      step: input.step,
      metadata: input.metadata,
    });
  },
};
