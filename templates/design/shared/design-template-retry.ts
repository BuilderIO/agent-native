import { sourceContentHash } from "./source-workspace.js";

export function designTemplateRetryKey(input: {
  templateId: string;
  title: string;
  designSystemId?: string | null;
  prompt?: string;
}): string {
  return sourceContentHash(
    JSON.stringify({
      templateId: input.templateId,
      title: input.title,
      designSystemId:
        input.designSystemId === undefined ? "inherit" : input.designSystemId,
      prompt: input.prompt?.trim() || null,
    }),
  );
}
