import { defineAction } from "@agent-native/core/action";
import {
  designSystemArtifactInputFromContent,
  writeDesignSystemArtifactAgentSchema,
} from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  description:
    "Save one real artifact using required content: {kind:'foundation',tokens:[{name:'primary',value:'#2a4d69'}]}, {kind:'component',html:'complete standalone HTML'}, or {kind:'usage-rule',text:'Markdown guidance'}. Source-derived synthesis is inferred, fresh content generated, user-specified content manual; extracted is reserved for deterministic readers/migrations and is rejected here. Use target expectedRevision (0 for new), preserve targetId on edits, and reuse operationId only for identical retries. Correct attribution by reading and rewriting the same content with the corrected provenance and a new operationId. Returns persisted workspace and exact write receipt; failures never erase the last artifact.",
  schema: writeDesignSystemArtifactAgentSchema,
  run: (args) =>
    designSystemAuthoring.write(designSystemArtifactInputFromContent(args)),
});
