import type { FieldType } from "@/hooks/use-custom-fields";

export const FIELD_TYPE_LABEL_KEYS: Record<FieldType, string> = {
  text: "fields.types.text",
  rich_text: "fields.types.richText",
  number: "fields.types.number",
  percent: "fields.types.percent",
  currency: "fields.types.currency",
  single_select: "fields.types.singleSelect",
  multi_select: "fields.types.multiSelect",
  date: "fields.types.date",
};

export const FIELD_TYPE_VALUES: FieldType[] = [
  "text",
  "rich_text",
  "number",
  "percent",
  "currency",
  "single_select",
  "multi_select",
  "date",
];
