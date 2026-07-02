import {
  deleteAppState,
  writeAppState,
} from "@agent-native/core/application-state";

import {
  CLIPS_BUILDER_CREDITS_STATE_KEY,
  createBuilderCreditsExhaustedStatus,
  type BuilderCreditsSource,
} from "../../shared/builder-credits.js";

export async function noteBuilderCreditsExhausted({
  source,
  message,
}: {
  source: BuilderCreditsSource;
  message: string;
}): Promise<void> {
  try {
    await writeAppState(
      CLIPS_BUILDER_CREDITS_STATE_KEY,
      createBuilderCreditsExhaustedStatus({
        source,
        message,
      }) as unknown as Record<string, unknown>,
    );
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (err) {
    console.warn(
      "[clips] failed to record Builder credit state:",
      (err as Error)?.message ?? String(err),
    );
  }
}

export async function clearBuilderCreditsExhausted(): Promise<void> {
  try {
    const removed = await deleteAppState(CLIPS_BUILDER_CREDITS_STATE_KEY);
    if (removed) await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (err) {
    console.warn(
      "[clips] failed to clear Builder credit state:",
      (err as Error)?.message ?? String(err),
    );
  }
}
