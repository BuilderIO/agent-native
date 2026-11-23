import { defineNitroPlugin } from "@agent-native/core/server";

// Refuses to start the local harness anywhere but a development server on isolated PostgreSQL with the
// loopback fake installed.
export default defineNitroPlugin(() => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.NODE_ENV !== "development" ||
    database.protocol !== "postgresql:" ||
    database.hostname !== "127.0.0.1" ||
    !database.port ||
    database.username !== "qa_analytics2" ||
    database.password !== "" ||
    database.pathname !== "/qa_analytics2" ||
    database.search !== "" ||
    database.hash !== "" ||
    !(
      globalThis as typeof globalThis & { __analyticsLocalFakeUrl?: string }
    ).__analyticsLocalFakeUrl?.startsWith("http://127.0.0.1:")
  )
    throw new Error(
      "Local E2E requires development, isolated PostgreSQL and the loopback provider fake",
    );
});
