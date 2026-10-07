const devDatabaseCloseApps = new WeakSet<object>();

export function installDevDatabaseCloseHook(nitroApp: any): void {
  if (process.env.NODE_ENV !== "development") return;
  if (!nitroApp?.hooks?.hook || devDatabaseCloseApps.has(nitroApp)) return;
  devDatabaseCloseApps.add(nitroApp);

  nitroApp.hooks.hook("close", async () => {
    const { closeDbExec } = await import("../db/client.js");
    await closeDbExec();
  });
}
