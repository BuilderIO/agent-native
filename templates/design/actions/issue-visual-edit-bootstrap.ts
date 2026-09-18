import crypto from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { signEmbedSessionToken } from "@agent-native/core/server";
import { z } from "zod";

const BOOTSTRAP_TTL_SECONDS = 5 * 60;
const BOOTSTRAP_SCOPE_PREFIX = "capability:visual-edit-bootstrap:";
const BOOTSTRAP_PRINCIPAL_DOMAIN = "local.visual-edit.agent-native.invalid";

/**
 * Issue a short-lived bearer used only to cross the signed-out page bootstrap
 * boundary. It carries no account identity; open-visual-edit derives a fresh
 * owner partition from the opaque capability instead.
 */
export default defineAction({
  description:
    "Issue a short-lived signed-out visual-edit bootstrap capability for the current Design page.",
  requiresAuth: false,
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  schema: z.object({}),
  run: async () => {
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
