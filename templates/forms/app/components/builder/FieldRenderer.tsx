import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { FormField } from "@shared/types";

interface FieldRendererProps {
  field: FormField;
  value?: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  preview?: boolean;
}

export function FieldRenderer({
  field,
  value,
  onChange,
  disabled,
  preview,
}: FieldRendererProps) {
  const handleChange = (v: unknown) => onChange?.(v);

  return (
    <div
      className={cn(
        "space-y-2",
        field.width === "half" ? "w-full sm:w-1/2" : "w-full",
      )}
    >
      <Label className="text-sm font-medium">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}

      {field.type === "text" && (
        <Input
          placeholder={field.placeholder || ""}
          value={(value as string) || ""}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
        />
      )}

      {field.type === "email" && (
        <Input
          type="email"
          placeholder={field.placeholder || "you@example.com"}
          value={(value as string) || ""}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
        />
      )}

      {field.type === "number" && (
        <Input
          type="number"
          placeholder={field.placeholder || ""}
          value={(value as string) || ""}
          onChange={(e) => handleChange(e.target.value)}
          min={field.validation?.min}
          max={field.validation?.max}
          disabled={disabled}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          placeholder={field.placeholder || ""}
          value={(value as string) || ""}
          onChange={(e) => handleChange(e.target.value)}
          rows={4}
          disabled={disabled}
        />
      )}

      {field.type === "select" && (
        <Select
          value={(value as string) || ""}
          onValueChange={handleChange}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={field.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {(field.options || []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.type === "multiselect" && (
        <div className="space-y-1">
          {(field.options || []).map((opt) => {
            const selected = Array.isArray(value) ? value : [];
            return (
              <label
                key={opt}
                className="flex items-center gap-2.5 text-sm min-h-[44px] py-1"
              >
                <Checkbox
                  checked={selected.includes(opt)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...selected, opt]
                      : selected.filter((s: string) => s !== opt);
                    handleChange(next);
                  }}
                  disabled={disabled}
                />
                {opt}
              </label>
            );
          })}
        </div>
      )}

      {field.type === "checkbox" && (
        <label className="flex items-center gap-2.5 text-sm min-h-[44px]">
          <Checkbox
            checked={!!value}
            onCheckedChange={handleChange}
            disabled={disabled}
          />
          {field.placeholder || field.label}
        </label>
      )}

      {field.type === "radio" && (
        <RadioGroup
          value={(value as string) || ""}
          onValueChange={handleChange}
          disabled={disabled}
        >
          {(field.options || []).map((opt) => (
            <div key={opt} className="flex items-center gap-2.5 min-h-[44px]">
              <RadioGroupItem value={opt} id={`${field.id}-${opt}`} />
              <Label htmlFor={`${field.id}-${opt}`} className="font-normal">
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {field.type === "date" && (
        <Input
          type="date"
          value={(value as string) || ""}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
        />
      )}

      {field.type === "rating" && (
        <div className="flex gap-0.5 sm:gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => !disabled && handleChange(star)}
              className="p-2 sm:p-1.5"
              disabled={disabled}
              aria-label={`${star} star${star !== 1 ? "s" : ""}`}
            >
              {(value as number) >= star ? (
                <IconStarFilled className="h-7 w-7 sm:h-6 sm:w-6 text-amber-400" />
              ) : (
                <IconStar className="h-7 w-7 sm:h-6 sm:w-6 text-muted-foreground/30" />
              )}
            </button>
          ))}
        </div>
      )}

      {field.type === "scale" && (
        <div className="pt-2">
          <Slider
            value={[(value as number) || field.validation?.min || 1]}
            onValueChange={([v]) => handleChange(v)}
            min={field.validation?.min || 1}
            max={field.validation?.max || 10}
            step={1}
            disabled={disabled}
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{field.validation?.min || 1}</span>
            <span>{String(value ?? "-")}</span>
            <span>{field.validation?.max || 10}</span>
          </div>
        </div>
      )}
    </div>
  );
}
