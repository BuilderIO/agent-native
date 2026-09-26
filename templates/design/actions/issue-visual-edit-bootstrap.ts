import crypto from "node:crypto";

import { fail } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { signEmbedSessionToken } from "@agent-native/core/server";
import { z } from "zod";

import { isSameOriginVisualEditBrowserRequest } from "./visual-edit-browser-request.js";

const BOOTSTRAP_TTL_SECONDS = 5 * 60;
const BOOTSTRAP_SCOPE_PREFIX = "capability:visual-edit-bootstrap:";
const BOOTSTRAP_PRINCIPAL_DOMAIN = "local.visual-edit.agent-native.invalid";

export default defineAction({
  description:
    "Issue a short-lived signed-out visual-edit bootstrap capability for the current Design page.",
  requiresAuth: false,
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  schema: z.object({}),
  run: async (_args, ctx) => {
    if (!isSameOriginVisualEditBrowserRequest(ctx)) {
      fail(
        "Visual-edit bootstrap is available only from the same-origin Design page.",
        { errorCode: "signed_out_visual_edit_browser_required" },
      );
    }
    const nonce = crypto.randomBytes(24).toString("base64url");
    const scope = `${BOOTSTRAP_SCOPE_PREFIX}${nonce}`;
    return {
      token: signEmbedSessionToken({
        ownerEmail: `bootstrap+${nonce}@${BOOTSTRAP_PRINCIPAL_DOMAIN}`,
        targetPath: "/visual-edit",
        scope,
        ttlSeconds: BOOTSTRAP_TTL_SECONDS,
      }),
      challenge: nonce,
    };
  },
});
