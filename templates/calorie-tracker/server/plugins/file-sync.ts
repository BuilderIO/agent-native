import { createFileSyncPlugin } from "@agent-native/core/server";

const basePlugin = createFileSyncPlugin();
export default async (nitroApp: any) => await basePlugin(nitroApp);
