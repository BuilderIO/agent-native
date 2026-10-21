import type { NodeKind, WorkflowNodeOfKind } from "@/lib/workflow-editor";

import type { FormContext } from "../context";

export interface FormProps<K extends NodeKind> {
  settings: WorkflowNodeOfKind<K>["settings"];
  onChange: (settings: WorkflowNodeOfKind<K>["settings"]) => void;
  context: FormContext;
}

/** Sets `key` to `value`, or removes it when the value is empty. */
export function withOptional<T extends object, K extends keyof T>(
  settings: T,
  key: K,
  value: T[K] | undefined | "",
): T {
  const { [key]: _removed, ...rest } = settings;
  return value === undefined || value === ""
    ? (rest as T)
    : ({ ...rest, [key]: value } as T);
}
