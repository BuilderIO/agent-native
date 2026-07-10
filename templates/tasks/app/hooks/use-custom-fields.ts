import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FieldDefinition,
  FieldType,
} from "../../server/custom-fields/types.js";
import { invalidateCustomFields, invalidateTasks, invalidateVisibleTaskFields } from "./cache";

export type {
  FieldConfig,
  FieldDefinition,
  FieldType,
  SelectColorToken,
  SelectOption,
} from "../../server/custom-fields/types.js";
export type { FieldValue, FieldValueInput } from "../../server/custom-fields/values/store.js";
export type { TaskFieldValue } from "../../server/custom-fields/task-fields.js";

type ListCustomFieldsData = { fields: FieldDefinition[] };

export function useCustomFields() {
  const query = useActionQuery("list-custom-fields", {});
  const listData = query.data as ListCustomFieldsData | undefined;

  return {
    ...query,
    fields: listData?.fields ?? [],
  };
}

export function useCreateCustomField() {
  const queryClient = useQueryClient();
  return useActionMutation<
    FieldDefinition,
    { title: string; type: FieldType; config?: unknown }
  >("create-custom-field", {
    onSettled: () => {
      invalidateCustomFields(queryClient);
      invalidateTasks(queryClient);
      invalidateVisibleTaskFields(queryClient);
    },
  });
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient();
  return useActionMutation<
    FieldDefinition,
    { fieldId: string; title?: string; config?: unknown }
  >("update-custom-field", {
    onSettled: () => {
      invalidateCustomFields(queryClient);
      invalidateTasks(queryClient);
      invalidateVisibleTaskFields(queryClient);
    },
  });
}

export function useDeleteCustomField() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { ok: true; deletedValues: number },
    { fieldId: string }
  >("delete-custom-field", {
    onSettled: () => {
      invalidateCustomFields(queryClient);
      invalidateTasks(queryClient);
      invalidateVisibleTaskFields(queryClient);
    },
  });
}

export function useReorderCustomFields() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { fields: FieldDefinition[] },
    { fieldIds: string[] }
  >("reorder-custom-fields", {
    onSettled: () => {
      invalidateCustomFields(queryClient);
      invalidateTasks(queryClient);
      invalidateVisibleTaskFields(queryClient);
    },
  });
}
