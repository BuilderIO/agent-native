import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import actionsRegistry from "../../.generated/actions-registry.js";
import "../register-secrets.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-libraries",
  "list-assets",
  "search-assets",
  "get-asset",
  "generate-image",
  "generate-image-batch",
  "edit-image",
  "restyle-image",
  "refine-image",
  "save-generated-asset",
  "export-asset",
  "create-library",
  "create-collection",
  "open-asset-picker",
  "navigate",
];

export default createAgentChatPlugin({
  appId: "assets",
  mcpServerInfo: {
    title: "Agent-Native Assets",
    description:
      "Create, search, select, and export brand image and video assets from Assets.",
    websiteUrl: "/",
    icons: [
      {
        src: "/agent-native-icon-light-512.png?v=20260530",
        mimeType: "image/png",
        sizes: ["512x512"],
      },
    ],
  },
  initialToolNames: INITIAL_TOOL_NAMES,
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  runSoftTimeoutMs: 240_000,
});
