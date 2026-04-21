import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

// macros uses drizzle-kit's default `./drizzle` migrations directory.
export default createDrizzleConfig({ out: "./drizzle" });
