import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { peerLinkOrigins } from "../server/lib/app-peer.js";

export default defineAction({
  description:
    "Where this Content's Design, Slides and Clips apps live: for each, the app URLs whose item links a paste turns into a link card. An app that isn't set up has none.",
  schema: z.object({}),
  outputSchema: z.object({
    design: z.array(z.string()),
    slides: z.array(z.string()),
    clips: z.array(z.string()),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async () => ({
    design: peerLinkOrigins("design"),
    slides: peerLinkOrigins("slides"),
    clips: peerLinkOrigins("clips"),
  }),
});
