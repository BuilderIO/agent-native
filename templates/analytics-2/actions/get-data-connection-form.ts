import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataConnectionOutput,
  getDataConnectionForm,
} from "../server/model/data-connections.js";
const output = z.object({
  connection: dataConnectionOutput,
  // Nonsecret canonical edit baseline; no credential or config blob.
  baseline: z
    .object({
      description: z.string(),
      aiUsage: z.enum(["included", "excluded"]),
      annotationRevision: z.number().int().nonnegative(),
    })
    .strict(),
  nativeRevision: z.string().min(1).max(200).optional(),
  configuredCredentialFields: z.array(z.string()),
  values: z.record(
    z.string(),
    z.union([
      z.string(),
      z.boolean(),
      z.number(),
      z.null(),
      z.array(z.string()),
    ]),
  ),
});
export default defineAction({
  description:
    "Read editable connection metadata and access selections for an authorized workspace admin. Credentials are write-only and excluded.",
  schema: z
    .object({ id: z.string().min(1), requestId: z.string().uuid().optional() })
    .strict(),
  outputSchema: output,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ id, requestId }) =>
    output.parse(await getDataConnectionForm(id, requestId)),
});
