import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  // Remove this option to use built-in marketing, or supply an object for custom copy.
  marketing: false,
});
