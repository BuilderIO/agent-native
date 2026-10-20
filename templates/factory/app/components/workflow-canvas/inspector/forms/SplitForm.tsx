import { useId } from "react";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, PathInput } from "../fields";
import type { FormProps } from "./types";

export function SplitForm({ settings, onChange, context }: FormProps<"split">) {
  const s = useWorkflowCanvasStrings();

  const id = useId();
  return (
    <Field label={s.inspector.split.field} htmlFor={id}>
      <PathInput
        id={id}
        value={settings.field}
        context={context}
        onChange={(field) => onChange({ ...settings, field })}
      />
    </Field>
  );
}
