import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listIdentityState } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "List linked external identities and active link tokens.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listIdentityState(),
});
