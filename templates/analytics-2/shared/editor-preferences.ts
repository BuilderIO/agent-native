import { z } from "zod";

export const editorPreferences = z.strictObject({
  lineNumbers: z.boolean(),
  fullWidthCells: z.boolean(),
  agentOpen: z.boolean().optional(),
  vim: z.boolean().optional(),
  addTextKind: z.enum(["text", "markdown"]).optional(),
});
export const editorPreferencesPatch = editorPreferences
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one preference is required",
  );
export type EditorPreferences = z.infer<typeof editorPreferences>;
export type EditorPreferencesPatch = z.infer<typeof editorPreferencesPatch>;
export const defaultEditorPreferences: EditorPreferences = {
  lineNumbers: true,
  fullWidthCells: true,
};
