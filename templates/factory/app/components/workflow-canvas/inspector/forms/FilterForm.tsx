import { RulesEditor } from "../RulesEditor";
import type { FormProps } from "./types";

export function FilterForm({
  settings,
  onChange,
  context,
}: FormProps<"filter">) {
  return (
    <RulesEditor
      combinator={settings.combinator}
      onCombinator={(combinator) => onChange({ ...settings, combinator })}
      rules={settings.rules}
      context={context}
      onChange={(rules) => onChange({ ...settings, rules })}
    />
  );
}
