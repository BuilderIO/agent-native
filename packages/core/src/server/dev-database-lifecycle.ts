import {
  beginPgliteClientShutdown,
  closeDbExec,
  resumePgliteClientAccess,
  waitForPgliteClientOperations,
} from "../db/client.js";
import { stopBackgroundJobs } from "./background-jobs.js";

const devDatabaseCloseApps = new WeakSet<object>();
let devDatabaseClosePromise: Promise<void> | undefined;
const devDatabaseHot = (
  import.meta as ImportMeta & {
    hot?: {
      on(event: string, listener: (payload: any) => void): void;
      send(event: string, payload?: any): void;
    };
  }
).hot;

if (process.env.NODE_ENV === "development" && devDatabaseHot) {
  devDatabaseHot.on("agent-native:dev-database-resume", (payload) => {
    if (typeof payload?.requestId !== "string") return;
    resumePgliteClientAccess();
    devDatabaseClosePromise = undefined;
    devDatabaseHot.send("agent-native:dev-database-resumed", {
      requestId: payload.requestId,
    });
  });

  devDatabaseHot.on("agent-native:dev-database-close", (payload) => {
    if (typeof payload?.requestId !== "string") return;
    void closeDevDatabase(payload.requestId).then(
      () =>
        devDatabaseHot.send("agent-native:dev-database-closed", {
          requestId: payload.requestId,
        }),
      (error) =>
        devDatabaseHot.send("agent-native:dev-database-closed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: payload.requestId,
        }),
    );
  });
}

async function closeDevDatabase(requestId?: string): Promise<void> {
  beginPgliteClientShutdown();
  if (requestId) {
    devDatabaseHot?.send("agent-native:dev-database-closing", { requestId });
  }
  devDatabaseClosePromise ??= (async () => {
    await waitForPgliteClientOperations();
    await closeDbExec();
  })();
  try {
    await devDatabaseClosePromise;
  } catch (error) {
    devDatabaseClosePromise = undefined;
    throw error;
  }
}

export function installDevDatabaseCloseHook(nitroApp: any): void {
  if (!nitroApp?.hooks?.hook || devDatabaseCloseApps.has(nitroApp)) return;
  devDatabaseCloseApps.add(nitroApp);
  // Jobs must stop first: a tick against a closing client becomes an
  // unhandled rejection and its next interval keeps the process alive.
  // Keep this on the Nitro close hook (not inside closeDevDatabase): a
  // Vite HMR restart closes/resumes the DB through that same function and
  // nothing restarts jobs on resume.
  nitroApp.hooks.hook("close", async () => {
    stopBackgroundJobs();
    await closeDevDatabase();
  });
}
