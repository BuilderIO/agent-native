import { errors, type CDPSession, type Page } from "@playwright/test";

import { runRuntimeZoomAttempt } from "./_runtime-budget-zoom-attempt";
import {
  readRuntimeZoomSnapshot,
  type ZoomSnapshotConfig,
  type ZoomSnapshotRead,
} from "./_runtime-budget-zoom-snapshot";

export function runRuntimeZoomBrowserAttempt(
  target: number,
  page: Page,
  cdp: CDPSession,
  config: Omit<ZoomSnapshotConfig, "readout">,
  now = Date.now,
) {
  const readout = page.getByRole("button", { name: /^\d+%$/ }).first();
  return runRuntimeZoomAttempt(target, {
    read: async (deadline, trackCleanup) => {
      if (now() >= deadline)
        return { status: "unavailable", reason: "attempt-deadline-exceeded" };
      // elementHandles queries current matches without waiting for a toolbar mount.
      const [handle] = await readout.elementHandles();
      let outcome:
        | { ok: true; value: ZoomSnapshotRead }
        | { ok: false; cause: unknown };
      try {
        let value: ZoomSnapshotRead;
        if (now() >= deadline)
          value = {
            status: "unavailable",
            reason: "attempt-deadline-exceeded",
          };
        else if (!handle)
          value = { status: "unavailable", reason: "toolbar-absent" };
        else
          value = await page.evaluate(readRuntimeZoomSnapshot, {
            ...config,
            readout: handle,
          });
        outcome = { ok: true, value };
      } catch (cause) {
        outcome = { ok: false, cause };
      }
      const failed = !outcome.ok || outcome.value.status === "error";
      if (failed && handle) trackCleanup(() => handle.dispose());
      else await handle?.dispose();
      if (!outcome.ok) throw outcome.cause;
      return outcome.value;
    },
    apply: async (deadline) => {
      const remainingTimeout = () => {
        const remaining = deadline - now();
        if (remaining <= 0)
          throw new errors.TimeoutError(
            "Runtime zoom attempt deadline exhausted before input operation",
          );
        return remaining;
      };
      await readout.click({ timeout: remainingTimeout() });
      const zoomInput = page.getByRole("textbox", { name: "Zoom percentage" });
      await zoomInput.fill(`${target}%`, { timeout: remainingTimeout() });
      await zoomInput.press("Enter", { timeout: remainingTimeout() });
    },
    wait: (ms) => page.waitForTimeout(ms),
    cleanup: () => cdp.send("Runtime.terminateExecution"),
    isTimeout: (cause) => cause instanceof errors.TimeoutError,
    now,
  });
}
