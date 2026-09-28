export type CompletionCardAction = "open" | "copy" | "dismiss";
export type CompletionCardActionResult =
  | { status: "dismissed" }
  | { status: "busy" }
  | { status: "failed"; stage: CompletionCardAction; error: unknown };

export function createCompletionCardActions(deps: {
  open: (url: string) => Promise<void>;
  copy: (url: string) => Promise<void>;
  dismiss: () => Promise<void>;
}) {
  let busy = false;
  const completed = new Set<string>();
  return async (
    action: CompletionCardAction,
    url = "",
  ): Promise<CompletionCardActionResult> => {
    if (busy) return { status: "busy" };
    busy = true;
    let stage = action;
    try {
      if (action !== "dismiss") {
        const key = JSON.stringify([action, url]);
        if (!completed.has(key)) {
          await deps[action](url);
          completed.add(key);
        }
      }
      stage = "dismiss";
      await deps.dismiss();
      return { status: "dismissed" };
    } catch (error) {
      return { status: "failed", stage, error };
    } finally {
      busy = false;
    }
  };
}

export async function dismissCompletionCardWindow(deps: {
  releaseHold: () => Promise<unknown>;
  restoreHold: () => Promise<unknown>;
  close: () => Promise<void>;
  onReleaseFailure: (error: unknown) => void;
}): Promise<void> {
  void Promise.resolve().then(deps.releaseHold).catch(deps.onReleaseFailure);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(deps.close),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Completion window close timed out")),
          3_000,
        );
      }),
    ]);
  } catch (error) {
    void Promise.resolve().then(deps.restoreHold).catch(deps.onReleaseFailure);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
