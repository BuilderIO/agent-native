import { defineAction } from "@agent-native/core";
import { z } from "zod";

import type { BuilderCmsModelsResponse } from "../shared/api.js";
import { listBuilderCmsModels } from "./_builder-cms-read-client.js";

export default defineAction({
  description:
    "List Builder CMS models available to attach as read-only database sources. Uses configured Builder credentials and never writes to Builder.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<BuilderCmsModelsResponse> => {
    return listBuilderCmsModels();
  },
});
