import { defineAction } from "@agent-native/core/action";
import { getBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { z } from "zod";

export default defineAction({
  description:
    "Read the signed-in caller's Builder-account access to DSI without returning credentials.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: () => getBuilderDsiAccess(),
});
