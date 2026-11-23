import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InputSelect<Value extends string>({
  id,
  label,
  descriptionId,
  placeholder,
  options,
  value,
  disabled = false,
  onChange,
}: {
  id?: string;
  label: string;
  descriptionId?: string | undefined;
  placeholder?: string;
  options: readonly { value: Value; label: string; disabled?: boolean }[];
  value: Value | undefined;
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <Select
      value={selected ? `choice:${selected.value}` : ""}
      disabled={disabled}
      onValueChange={(value) => {
        const option = options.find(
          (entry) => `choice:${entry.value}` === value,
        );
        if (option) onChange(option.value);
      }}
    >
      <SelectTrigger
        id={id}
        size="sm"
        className="min-w-0 [&>svg]:shrink-0"
        aria-label={label}
        aria-describedby={descriptionId}
      >
        <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(({ value, label, disabled = false }) => (
          <SelectItem key={value} value={`choice:${value}`} disabled={disabled}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
