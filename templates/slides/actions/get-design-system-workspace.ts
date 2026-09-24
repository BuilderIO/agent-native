import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  description:
    "Read a scoped design-system authoring snapshot: conversation, sources, run state and artifact revisions. Legacy systems return workspace:null; use resume-design-system-authoring to begin editing them.",
  schema: z.object({ id: z.string().min(1).describe("Design system ID") }),
  http: { method: "GET" },
  readOnly: true,
  run: ({ id }) => designSystemAuthoring.get(id),
});
