import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";

export default defineAction({
  description:
    "Get a single DAM asset by ID with preview, download, and embed URLs.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => serializeAsset(await getAssetOrThrow(id)),
});
