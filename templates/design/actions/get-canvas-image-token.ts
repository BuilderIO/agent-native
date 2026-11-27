import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { mintCanvasImageToken } from "../server/lib/canvas-image-token.js";

export default defineAction({
  agentTool: false,
  description:
    "Mint the signed token the canvas image resize proxy requires. Returns `available: false` when the proxy is not configured; callers then load original image URLs.",
  schema: z.object({}),
  outputSchema: z.discriminatedUnion("available", [
    z.object({
      available: z.literal(true),
      subject: z.string(),
      exp: z.number(),
      token: z.string(),
    }),
    z.object({ available: z.literal(false) }),
  ]),
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) fail("Sign in to load canvas images", { statusCode: 401 });
    const minted = mintCanvasImageToken(email, Date.now());
    return minted === null
      ? { available: false as const }
      : { available: true as const, ...minted };
  },
});
