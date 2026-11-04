import { useId } from "react";

import type { OnErrorMode } from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, SelectInput } from "../fields";
import { withOptional } from "./types";

/** What a step does with an item that fails at it. Absent reads as `stop`, so a step never saved with it still shows its true behavior. */
export function OnErrorField<S extends { onError?: OnErrorMode | undefined }>({
  settings,
  onChange,
}: {
  settings: S;
  onChange: (settings: S) => void;
}) {
  const s = useWorkflowCanvasStrings();
  const id = useId();
  const options = (["stop", "route"] as const).map((mode) => ({
    value: mode,
    label: s.inspector.onError[mode],
  }));
  return (
    <Field label={s.inspector.onError.label} htmlFor={id}>
      <SelectInput
        id={id}
        value={settings.onError ?? "stop"}
        options={options}
        onChange={(mode) =>
          onChange(
            withOptional(
              settings,
              "onError",
              mode === "route" ? mode : undefined,
            ),
          )
        }
      />
    </Field>
  );
}
