import { z } from "zod";

import { defineAction } from "../../action.js";
import { getFileStorageStatus } from "../storage-settings.js";

export default defineAction({
  description:
    "Read the workspace's S3-compatible file storage settings: whether they are complete, the inferred provider, the saved endpoint, bucket, region, and public URL (owners and admins only), which keys are saved, whether a public URL is required, and where new uploads go now. Secret values are never returned.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => getFileStorageStatus(ctx),
});
