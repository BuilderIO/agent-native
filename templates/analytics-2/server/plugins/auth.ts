import { registerAuthPublicPaths } from "@agent-native/core/server";
import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

registerAuthPublicPaths(["/api/kernel-stream-authorization"]);

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
});
