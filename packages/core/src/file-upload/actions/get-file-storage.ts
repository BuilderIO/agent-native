import { z } from "zod";

import { defineAction } from "../../action.js";
import { getFileStorageStatus } from "../storage-settings.js";

export default defineAction({
  description:
    "Read the workspace's S3-compatible file storage settings: whether they are complete or unavailable because saved values could not be decrypted, which fields are unreadable and saved (owners and admins only), the inferred provider, the saved endpoint, bucket, region, and public URL (owners and admins only), which keys are saved, whether a public URL is required, where new uploads go now or whether that provider check is unavailable, and whether private screenshot storage is ready in the selected storage context. Replace unreadable required values before saving other changes, or clear file storage. Secret values are never returned.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => getFileStorageStatus(ctx),
});
