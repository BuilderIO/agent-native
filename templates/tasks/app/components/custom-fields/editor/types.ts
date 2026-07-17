import type { FieldConfig, FieldType } from "@/hooks/use-custom-fields";

export type FieldDraft = {
  title: string;
  type: FieldType;
  config: FieldConfig;
};
