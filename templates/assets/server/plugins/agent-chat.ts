import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import actionsRegistry from "../../.generated/actions-registry.js";
import "../register-secrets.js";

export default createAgentChatPlugin({
  appId: "assets",
  mcpServerInfo: {
    title: "Agent-Native Assets",
    description:
      "Create, search, select, and export brand image and video assets from Assets.",
    websiteUrl: "/",
    icons: [
      {
        src: "/icon-512.svg?v=20260529",
        mimeType: "image/svg+xml",
        sizes: ["512x512"],
      },
    ],
  },
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  runSoftTimeoutMs: 240_000,
});
