import { useId } from "react";

import { END_OUTCOMES } from "@/lib/workflow-editor";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, SelectInput, TemplateInput, TextInput } from "../fields";
import type { FormProps } from "./types";
import { withOptional } from "./types";

export function EndForm({ settings, onChange, context }: FormProps<"end">) {
  const s = useWorkflowCanvasStrings();
  const outcomeOptions = END_OUTCOMES.map((value) => ({
    value,
    label: s.summary.end[value],
  }));

  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <Field label={s.inspector.end.outcome} htmlFor={`${id}-outcome`}>
        <SelectInput
          id={`${id}-outcome`}
          value={settings.outcome}
          options={outcomeOptions}
          onChange={(outcome) => onChange({ ...settings, outcome })}
        />
      </Field>
      <Field label={s.inspector.end.reason} htmlFor={`${id}-reason`}>
        <TemplateInput
          id={`${id}-reason`}
          value={settings.reason ?? ""}
          context={context}
          invalid={settings.outcome === "dismissed" && !settings.reason}
          onChange={(reason) =>
            onChange(withOptional(settings, "reason", reason))
          }
        />
      </Field>
      <Field label={s.inspector.end.setStatus} htmlFor={`${id}-status`}>
        <TextInput
          id={`${id}-status`}
          value={settings.setStatus ?? ""}
          onChange={(status) =>
            onChange(withOptional(settings, "setStatus", status))
          }
        />
      </Field>
    </div>
  );
}
