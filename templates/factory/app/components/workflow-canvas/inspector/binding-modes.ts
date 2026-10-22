import type { FieldBinding, OperationField } from "@/lib/workflow-editor";

const BINDING_MODES: readonly FieldBinding["mode"][] = ["fixed", "path", "ai"];

/**
 * A field that decides who or where an effect lands cannot be written by the
 * model (the save refuses it) unless the catalog marks that as reviewed. A
 * binding already in AI mode keeps its option so the control still shows it.
 */
export function offeredModes(
  field: OperationField,
  binding: FieldBinding | undefined,
): readonly FieldBinding["mode"][] {
  const modelMayWrite = !field.target || field.modelMayWrite === true;
  return modelMayWrite || binding?.mode === "ai"
    ? BINDING_MODES
    : BINDING_MODES.filter((mode) => mode !== "ai");
}
