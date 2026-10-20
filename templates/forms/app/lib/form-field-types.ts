import type { FormField, FormFieldType } from "@shared/types";

export const FILE_FIELD_TYPE = "file" as const;
export type AppFormFieldType = FormFieldType | typeof FILE_FIELD_TYPE;
export type AppFormField = Omit<FormField, "type"> & {
  type: AppFormFieldType;
  multiple?: boolean;
  accept?: string;
};

export function isFileField(field: FormField | AppFormField): boolean {
  return (field.type as string) === FILE_FIELD_TYPE;
}

export function getFileFieldOptions(field: FormField | AppFormField) {
  const appField = field as AppFormField;
  return {
    multiple: appField.multiple === true,
    accept: appField.accept?.trim() || undefined,
  };
}
