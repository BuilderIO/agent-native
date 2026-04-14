import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listOverview } from "../server/lib/dispatch-store.js";
import { listVaultOverview } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Get the dispatch overview metrics, recent activity, approval settings, and vault health.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const [overview, vault] = await Promise.all([
      listOverview(),
      listVaultOverview(),
    ]);
    return { ...overview, vault };
  },
});
