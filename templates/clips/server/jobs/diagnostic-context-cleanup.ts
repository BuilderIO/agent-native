import {
  getAppConfig,
  resolveDeployEnvironment,
} from "@agent-native/core/server";

import { cleanupDiagnosticContexts } from "../lib/diagnostic-context.js";
let running = false;
export default function registerDiagnosticContextCleanup() {
  if (
    !(
      getAppConfig().runtime.backgroundJobsEnabled ??
      resolveDeployEnvironment() === "production"
    )
  )
    return;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void cleanupDiagnosticContexts()
      .catch((error) =>
        console.error("[diagnostic-context] cleanup failed", error),
      )
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
}
