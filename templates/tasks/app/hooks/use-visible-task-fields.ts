import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  DEFAULT_TASK_CARD_FIELD_NAMES,
  TASK_CARD_FIELD_LIMIT,
} from "@shared/visible-task-fields";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { FieldDefinition } from "@/hooks/use-custom-fields";
import { useCustomFields } from "@/hooks/use-custom-fields";

import {
  invalidateVisibleTaskFields,
  LIST_VISIBLE_TASK_FIELDS_QUERY_KEY,
} from "./cache";

export { DEFAULT_TASK_CARD_FIELD_NAMES, TASK_CARD_FIELD_LIMIT };

const TASK_CARD_FIELD_NAMES_KEY = "task-card-field-names";
const TASK_CARD_FIELD_IDS_KEY = "task-card-field-ids";

function readStringArray(key: string, limit: number) {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .slice(0, limit);
  } catch {
    return [];
  }
}

function fieldIdsForNames(
  fieldNames: readonly string[],
  fields: readonly FieldDefinition[],
  limit: number,
) {
  const fieldsByName = new Map(
    fields.map((field) => [field.title.toLowerCase(), field.id]),
  );
  return fieldNames
    .map((name) => fieldsByName.get(name.toLowerCase()))
    .filter((id): id is string => Boolean(id))
    .slice(0, limit);
}

function readLegacyLocalStorageFieldIds(
  fields: readonly FieldDefinition[],
  limit: number,
) {
  const storedIds = readStringArray(TASK_CARD_FIELD_IDS_KEY, limit);
  if (storedIds.length > 0) {
    if (fields.length === 0) return [];
    const knownIds = new Set(fields.map((field) => field.id));
    return storedIds.filter((fieldId) => knownIds.has(fieldId));
  }

  if (fields.length === 0) return [];

  return fieldIdsForNames(
    readStringArray(TASK_CARD_FIELD_NAMES_KEY, limit),
    fields,
    limit,
  );
}

function clearLegacyLocalStorage() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TASK_CARD_FIELD_IDS_KEY);
  window.localStorage.removeItem(TASK_CARD_FIELD_NAMES_KEY);
}

type ListVisibleTaskFieldsData = { fieldIds: string[] };

export function useVisibleTaskFieldIds() {
  const query = useActionQuery("list-visible-task-fields", {});
  const { fields } = useCustomFields();
  const updateVisibleTaskFields = useUpdateVisibleTaskFields();
  const migratedRef = useRef(false);
  const listData = query.data as ListVisibleTaskFieldsData | undefined;

  useEffect(() => {
    if (migratedRef.current || query.isPending || !query.isSuccess) return;

    const hasLegacyIds =
      readStringArray(TASK_CARD_FIELD_IDS_KEY, TASK_CARD_FIELD_LIMIT).length >
      0;
    const hasLegacyNames =
      readStringArray(TASK_CARD_FIELD_NAMES_KEY, TASK_CARD_FIELD_LIMIT).length >
      0;
    if (!hasLegacyIds && !hasLegacyNames) {
      migratedRef.current = true;
      return;
    }

    if (fields.length === 0) return;

    const legacyFieldIds = readLegacyLocalStorageFieldIds(
      fields,
      TASK_CARD_FIELD_LIMIT,
    );
    if (legacyFieldIds.length === 0) {
      migratedRef.current = true;
      clearLegacyLocalStorage();
      return;
    }

    void updateVisibleTaskFields
      .mutateAsync({ fieldIds: legacyFieldIds })
      .then(() => {
        clearLegacyLocalStorage();
        migratedRef.current = true;
      })
      .catch(() => {
        // Keep localStorage so a later retry can migrate the saved selection.
      });
  }, [fields, query.isPending, query.isSuccess, updateVisibleTaskFields]);

  return {
    ...query,
    fieldIds: listData?.fieldIds ?? [],
  };
}

export function useUpdateVisibleTaskFields() {
  const queryClient = useQueryClient();
  return useActionMutation<{ fieldIds: string[] }, { fieldIds: string[] }>(
    "update-visible-task-fields",
    {
      onSettled: () => {
        invalidateVisibleTaskFields(queryClient);
      },
    },
  );
}
