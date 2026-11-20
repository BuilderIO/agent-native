import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { vi } from "vitest";

import runMigrations from "../server/plugins/db.js";

export const owner = { userEmail: "owner@example.test", orgId: "org-a" };
export const peer = { userEmail: "peer@example.test", orgId: "org-a" };
export const stranger = { userEmail: "stranger@example.test", orgId: "org-b" };

export const as = <T>(
  context: { userEmail: string; orgId?: string },
  fn: () => T,
) => runWithRequestContext(context, fn);

export async function startTestDb() {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.stubEnv("NODE_ENV", "development");
  await closeDbExec();
  await runMigrations(null);
}

export async function stopTestDb() {
  await closeDbExec();
  vi.unstubAllEnvs();
}
