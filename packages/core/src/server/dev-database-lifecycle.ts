const devDatabaseCloseApps = new WeakSet<object>();
const devDatabaseHot = (
  import.meta as ImportMeta & {
    hot?: {
      on(event: string, listener: (payload: any) => void): void;
      send(event: string, payload?: any): void;
    };
  }
).hot;

if (process.env.NODE_ENV === "development" && devDatabaseHot) {
  devDatabaseHot.on("agent-native:dev-database-close", (payload) => {
    if (typeof payload?.requestId !== "string") return;
    void closeDevDatabase().then(
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

async function closeDevDatabase(): Promise<void> {
  const { closeDbExec } = await import("../db/client.js");
  await closeDbExec();
}

export function installDevDatabaseCloseHook(nitroApp: any): void {
  if (process.env.NODE_ENV !== "development") return;
  if (!nitroApp?.hooks?.hook || devDatabaseCloseApps.has(nitroApp)) return;
  devDatabaseCloseApps.add(nitroApp);

  nitroApp.hooks.hook("close", closeDevDatabase);
}
