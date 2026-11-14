import {
  ActionHttpError,
  ActionRequestTimeoutError,
  ActionTransportError,
  isPlaywrightTargetTransportFailure,
} from "./run-outcomes.ts";

interface BrowserActionArgs {
  body: Record<string, unknown>;
  compatibilityVersion: string;
  source: string;
  timeoutMs: number;
}

interface ActionPage {
  evaluate<A, R>(run: (args: A) => Promise<R>, args: A): Promise<R>;
}

export async function deleteScratchDeck<T>(
  page: ActionPage,
  args: BrowserActionArgs,
): Promise<T> {
  const result = await page
    .evaluate(async ({ body, compatibilityVersion, source, timeoutMs }) => {
      try {
        const { callAction } = await import(source);
        const value: T = await callAction("delete-deck", body, {
          method: "DELETE",
          uiOnly: true,
          timeoutMs,
          // Cleanup can run before Vite's client bootstrap sets define globals.
          headers: {
            "X-Agent-Native-Client-Compatibility": compatibilityVersion,
          },
        });
        return { kind: "success" as const, value };
      } catch (error) {
        const fault = error as { status?: unknown; timedOut?: unknown } | null;
        // Playwright does not preserve custom Error properties across evaluate.
        return {
          kind: "failure" as const,
          message: String(error),
          status: typeof fault?.status === "number" ? fault.status : null,
          timedOut: fault?.timedOut === true,
        };
      }
    }, args)
    .catch((error: unknown) => {
      if (isPlaywrightTargetTransportFailure(error)) {
        throw new ActionTransportError(
          `delete-deck action evaluation failed: ${String(error)}`,
        );
      }
      throw error;
    });
  if (result.kind === "success") return result.value;
  if (result.timedOut) throw new ActionRequestTimeoutError(result.message);
  if (result.status !== null)
    throw new ActionHttpError("delete-deck", result.status);
  throw new ActionTransportError(result.message);
}
