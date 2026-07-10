import { defineAction } from "@agent-native/core/action";

import { createCustomFieldActionSchema } from "../server/custom-fields/schema.js";
import {
  createCustomField,
  requireUserEmail,
} from "../server/custom-fields/store.js";

export default defineAction({
  description:
    "Create a custom field definition. Field type is immutable after creation.",
  schema: createCustomFieldActionSchema,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return createCustomField({
      ownerEmail,
      title: args.title,
      type: args.type,
      config: args.config,
    });
  },
});
