import {
  beginPgliteClientShutdown,
  closeDbExec,
  resumePgliteClientAccess,
} from "../db/client.js";

const devDatabaseCloseApps = new WeakSet<object>();
let activeDevRequests = 0;
const devRequestDrainWaiters = new Set<() => void>();
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
  await waitForActiveDevRequests();
  await closeDbExec();
}

function waitForActiveDevRequests(): Promise<void> {
  if (activeDevRequests === 0) return Promise.resolve();
  return new Promise((resolve) => devRequestDrainWaiters.add(resolve));
}

function finishDevRequest(): void {
  activeDevRequests--;
  if (activeDevRequests !== 0) return;
  for (const resolve of devRequestDrainWaiters) resolve();
  devRequestDrainWaiters.clear();
}

export function installDevDatabaseCloseHook(nitroApp: any): void {
  if (process.env.NODE_ENV !== "development") return;
  if (!nitroApp?.hooks?.hook || devDatabaseCloseApps.has(nitroApp)) return;
  devDatabaseCloseApps.add(nitroApp);

  nitroApp.hooks.hook("request", () => {
    activeDevRequests++;
  });
  nitroApp.hooks.hook("response", finishDevRequest);

  nitroApp.hooks.hook("close", closeDevDatabase);
}
