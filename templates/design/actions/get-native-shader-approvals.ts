import { defineAction, fail } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import {
  NativeEffectApprovalStateError,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";

export default defineAction({
  description:
    "Read the current viewer's exact native effect approvals for an accessible Design.",
  schema: z.object({ designId: z.string().min(1) }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    if (!(await resolveAccess("design", designId)))
      fail("Design not found", { errorCode: "not_found", statusCode: 404 });
    try {
      const approvals = parseNativeEffectApprovalState(
        await readAppState(nativeEffectApprovalKey(designId)),
      );
      return { designId, approvedDefinitionHashes: approvals.hashes };
    } catch (error) {
      if (!(error instanceof NativeEffectApprovalStateError)) throw error;
      fail("Native effect approval state is unreadable.", {
        errorCode: "native_effect_approvals_unreadable",
        statusCode: 422,
      });
    }
  },
});
