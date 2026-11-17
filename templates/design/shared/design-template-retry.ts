import type { DesignBrief } from "./design-briefs.js";
import { sourceContentHash } from "./source-workspace.js";

export function designTemplateRetryKey(input: {
  templateId: string;
  title: string;
  designSystemId?: string | null;
  prompt?: string;
  briefs?: readonly DesignBrief[];
}): string {
  return sourceContentHash(
    JSON.stringify({
      templateId: input.templateId,
      title: input.title,
      designSystemId:
        input.designSystemId === undefined ? "inherit" : input.designSystemId,
      prompt: input.prompt?.trim() || null,
      // Only when pages are attached, so copies without them keep their key.
      ...(input.briefs?.length
        ? { briefs: input.briefs.map((brief) => [brief.id, brief.url]) }
        : {}),
    }),
  );
}
