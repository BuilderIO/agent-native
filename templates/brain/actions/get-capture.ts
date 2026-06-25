import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getAccessibleCapture, serializeCapture } from "../server/lib/brain.js";
import {
  redactSensitiveText,
  redactSensitiveValue,
} from "../server/lib/search.js";

const booleanFlagSchema = z
  .preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean())
  .default(false);

function redactOptionalText(value: string | null) {
  return value ? redactSensitiveText(value) : value;
}

export default defineAction({
  description:
    "Get one Brain capture by ID if its source is accessible. Returns redacted content by default; pass includeRawContent=true only for authorized distillation or exact quote validation.",
  schema: z.object({
    id: z.string().min(1),
    includeRawContent: booleanFlagSchema.describe(
      "Return the exact raw capture body and metadata for authorized distillation or evidence quote validation.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id, includeRawContent }) => {
    const access = await getAccessibleCapture(id);
    if (!access) return { capture: null };
    const capture = serializeCapture(access.capture);
    if (includeRawContent) {
      await assertAccess("brain-source", access.capture.sourceId, "editor");
      return {
        capture: {
          ...capture,
          contentRedacted: false,
          rawContentIncluded: true,
        },
        source: {
          id: access.source.id,
          title: access.source.title,
          provider: access.source.provider,
        },
        accessRole: access.role,
      };
    }
    return {
      capture: {
        ...capture,
        externalId: redactOptionalText(capture.externalId),
        title: redactSensitiveText(capture.title),
        content: redactSensitiveText(capture.content),
        metadata: redactSensitiveValue(capture.metadata),
        importedBy: redactOptionalText(capture.importedBy),
        contentRedacted: true,
        rawContentIncluded: false,
      },
      source: {
        id: access.source.id,
        title: redactSensitiveText(access.source.title),
        provider: access.source.provider,
      },
      accessRole: access.role,
    };
  },
});
