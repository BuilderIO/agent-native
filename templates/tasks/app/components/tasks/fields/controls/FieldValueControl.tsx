import type { FieldValue, TaskFieldValue } from "@/hooks/use-custom-fields";
import { DateValueControl } from "./DateValueControl";
import { MultiSelectValueControl } from "./MultiSelectValueControl";
import { NumberValueControl } from "./NumberValueControl";
import { RichTextValueControl } from "./RichTextValueControl";
import { SingleSelectValueControl } from "./SingleSelectValueControl";
import { TextValueControl } from "./TextValueControl";

export function FieldValueControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: TaskFieldValue;
  value: FieldValue | null;
  disabled: boolean;
  onChange: (value: FieldValue | null) => void;
}) {
  switch (field.type) {
    case "text":
      return (
        <TextValueControl
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "rich_text":
      return (
        <RichTextValueControl
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(next) => onChange(next || null)}
        />
      );
    case "number":
    case "percent":
    case "currency":
      return (
        <NumberValueControl
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "date":
      return (
        <DateValueControl
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "single_select":
      return (
        <SingleSelectValueControl
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "multi_select":
      return (
        <MultiSelectValueControl
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
  }
}
