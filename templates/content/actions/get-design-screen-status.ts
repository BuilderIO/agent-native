import { defineAction } from "@agent-native/core/action";
import { designScreenStatusSchema } from "@agent-native/core/shared";
import { z } from "zod";

import { requestDesign } from "../server/lib/design-peer.js";
import {
  authorizeDesignScreenPage,
  designScreenDocumentIdSchema,
} from "./_design-screen-access.js";
import { visibilityForPageOrganization } from "./_embed-page-access.js";

const STATUS_TIMEOUT_MS = 15_000;
const MAX_DESIGNS = 20;

const idSchema = z.string().regex(/^[A-Za-z0-9._-]{1,200}$/);

export default defineAction({
  description:
    "For the Design screens pinned in a page you can open: who can open each screen's design now, each screen's current fingerprint, so a screen that changed in Design since it was pinned can say so, and its open comments. Renders nothing. Only designs you can open answer; the rest come back with an error.",
  schema: z.object({
    documentId: designScreenDocumentIdSchema,
    designs: z
      .array(
        z.object({
          designId: idSchema,
          screenIds: z.array(idSchema).max(50).default([]),
        }),
      )
      .min(1)
      .max(MAX_DESIGNS),
  }),
  outputSchema: z.object({
    designs: z.array(
      z.union([
        z.object({
          designId: z.string(),
          status: designScreenStatusSchema,
        }),
        z.object({ designId: z.string(), error: z.string() }),
      ]),
    ),
  }),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  run: async (args) => {
    const page = await authorizeDesignScreenPage(args.documentId, "viewer");
    const designs = await Promise.all(
      args.designs.map(async ({ designId, screenIds }) => {
        const answer = await requestDesign(
          "get-design-screen-status",
          { designId, screenIds },
          designScreenStatusSchema,
          STATUS_TIMEOUT_MS,
          page.authorityOrgId,
        );
        if (!answer.ok) return { designId, error: answer.message };
        const status = answer.data;
        return {
          designId,
          status: {
            ...status,
            design: {
              ...status.design,
              visibility: visibilityForPageOrganization(
                status.design.visibility,
                page,
              ),
            },
          },
        };
      }),
    );
    return { designs };
  },
});
