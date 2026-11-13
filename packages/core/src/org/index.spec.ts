import { expect, it } from "vitest";

import { createDbExec } from "../db/client.js";
import { assertIdentityColumnsRegistered } from "./index.js";

it("validates only the public schema of the supplied database", async () => {
  const db = await createDbExec({ url: "pglite:memory" });
  try {
    await db.execute("CREATE SCHEMA external_data");
    await db.execute("CREATE TABLE external_data.contacts (email TEXT)");
    await expect(assertIdentityColumnsRegistered(db)).resolves.toBeUndefined();
    await db.execute("CREATE TABLE public.contacts (email TEXT)");
    await expect(assertIdentityColumnsRegistered(db)).rejects.toThrow(
      "contacts.email looks identity-bearing",
    );
  } finally {
    await db.close?.();
  }
});
