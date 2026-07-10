import { useState, type FormEvent } from "react";
import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FieldConfig, FieldType } from "@/hooks/use-custom-fields";
import { FieldConfigControl } from "./editor/config/FieldConfigControl";
import { normalizedInitialConfig } from "./editor/config/utils";
import type { FieldDraft } from "./editor/types";

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "rich_text", label: "Rich text" },
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "currency", label: "Currency" },
  { value: "single_select", label: "Single-select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "date", label: "Date" },
];

const FIELD_TYPES_WITH_CONFIG = new Set<FieldType>([
  "currency",
  "number",
  "percent",
  "single_select",
  "multi_select",
]);

export function FieldCreateBar({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (draft: FieldDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [config, setConfig] = useState<FieldConfig>(
    normalizedInitialConfig("text"),
  );

  function handleTypeChange(nextType: FieldType) {
    setType(nextType);
    setConfig(normalizedInitialConfig(nextType));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    await onCreate({ title: trimmedTitle, type, config });
    setTitle("");
    setType("text");
    setConfig(normalizedInitialConfig("text"));
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="grid shrink-0 gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-[minmax(180px,1fr)_180px_auto] md:items-start"
    >
      <h2 className="text-sm font-medium md:col-span-3">Create new field</h2>
      <div className="grid gap-2">
        <Label htmlFor="new-field-title" className="sr-only">
          Field title
        </Label>
        <Input
          id="new-field-title"
          value={title}
          disabled={busy}
          placeholder="New field title"
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </div>
      <Select
        value={type}
        disabled={busy}
        onValueChange={(value) => handleTypeChange(value as FieldType)}
      >
        <SelectTrigger aria-label="Field type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {FIELD_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button type="submit" disabled={busy || title.trim().length === 0}>
        <IconPlus className="size-4" />
        Create
      </Button>
      {FIELD_TYPES_WITH_CONFIG.has(type) ? (
        <div className="md:col-span-3">
          <FieldConfigControl
            type={type}
            config={config}
            disabled={busy}
            onChange={setConfig}
          />
        </div>
      ) : null}
    </form>
  );
}
