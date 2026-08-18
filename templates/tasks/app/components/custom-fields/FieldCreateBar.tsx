import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

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
import { FIELD_TYPE_LABEL_KEYS, FIELD_TYPE_VALUES } from "./field-types";

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
  const t = useT();
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
      <h2 className="text-sm font-medium md:col-span-3">
        {t("fields.createNewFieldHeading")}
      </h2>
      <div className="grid gap-2">
        <Label htmlFor="new-field-title" className="sr-only">
          {t("fields.fieldTitleLabel")}
        </Label>
        <Input
          id="new-field-title"
          value={title}
          disabled={busy}
          placeholder={t("fields.newFieldTitlePlaceholder")}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </div>
      <Select
        value={type}
        disabled={busy}
        onValueChange={(value) => handleTypeChange(value as FieldType)}
      >
        <SelectTrigger aria-label={t("fields.fieldTypeAriaLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {FIELD_TYPE_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(FIELD_TYPE_LABEL_KEYS[value])}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button type="submit" disabled={busy || title.trim().length === 0}>
        <IconPlus className="size-4" />
        {t("fields.createButton")}
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
