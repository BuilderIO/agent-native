import { defineAction } from "@agent-native/core";
import { createRemoteDevice } from "@agent-native/core/integrations";
import {
  buildEmbedStartPath,
  createEmbedSessionTicket,
  getRequestContext,
  getRequestUserEmail,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  BROWSER_CHAT_NONCE_QUERY_PARAM,
  BROWSER_CHAT_PARENT_ORIGIN_QUERY_PARAM,
  browserChatExtensionIdSchema,
  browserChatNonceSchema,
} from "../lib/browser-chat-protocol.js";
import { isBrowserExtensionIdAllowed } from "../server/lib/browser-extension-allowlist.js";

export default defineAction({
  description:
    "Create a one-time authenticated Dispatch browser-chat embed session for an approved Agent-Native Chrome extension.",
  schema: z
    .object({
      nonce: browserChatNonceSchema,
      extensionId: browserChatExtensionIdSchema,
    })
    .strict(),
  readOnly: false,
  parallelSafe: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ nonce, extensionId }) => {
    const ownerEmail = getRequestUserEmail()?.trim();
    if (!ownerEmail) {
      throw new Error(
        "Sign in to Dispatch before connecting the browser extension.",
      );
    }

    const requestContext = getRequestContext();
    const { browserExtensionIds } = await import("../server/index.js").then(
      (module) => module.getDispatchConfig(),
    );
    if (
      !isBrowserExtensionIdAllowed({
        extensionId,
        configIds: browserExtensionIds,
        nodeEnv: process.env.NODE_ENV,
        requestOrigin: requestContext?.requestOrigin,
      })
    ) {
      throw new Error(
        "This browser extension is not allowed to connect to Dispatch.",
      );
    }

    const parentOrigin = `chrome-extension://${extensionId}`;
    const requestOrigin = requestContext?.requestOrigin;
    if (!requestOrigin) {
      throw new Error("Dispatch could not resolve its browser relay URL.");
    }
    const query = new URLSearchParams({
      [BROWSER_CHAT_NONCE_QUERY_PARAM]: nonce,
      [BROWSER_CHAT_PARENT_ORIGIN_QUERY_PARAM]: parentOrigin,
    });
    const session = await createEmbedSessionTicket({
      ownerEmail,
      orgId: requestContext?.orgId ?? null,
      targetPath: `/browser-chat?${query}`,
      scope: "browser-chat",
      ttlSeconds: 60,
    });
    const remote = await createRemoteDevice({
      ownerEmail,
      orgId: requestContext?.orgId ?? null,
      label: "Agent Native for Chrome",
      platform: "chrome-extension",
      metadata: {
        browserExtension: { extensionId },
        computerCapabilities: {
          browser: {
            observe: true,
            control: true,
            provider: "agent-native-chrome-extension",
          },
        },
      },
    });

    return {
      startPath: buildEmbedStartPath(session.ticket),
      expiresAt: session.expiresAt,
      parentOrigin,
      remoteDevice: { id: remote.device.id, token: remote.token },
      relayBaseUrl: withConfiguredAppBasePath(requestOrigin),
    };
  },
});
