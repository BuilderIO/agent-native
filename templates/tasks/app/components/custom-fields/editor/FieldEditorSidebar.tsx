import { useCallback } from "react";
import { toast } from "sonner";

import { SidePanel } from "@/components/shared/SidePanel";
import {
  useUpdateCustomField,
  type FieldDefinition,
} from "@/hooks/use-custom-fields";

import { FieldConfigControl } from "./config/FieldConfigControl";
import { FieldTitleSection } from "./FieldTitleSection";

export function FieldEditorSidebar({
  field,
  disabled,
  onClose,
}: {
  field: FieldDefinition | null;
  disabled: boolean;
  onClose: () => void;
}) {
  if (!field) return null;

  return (
    <SidePanel title="Field" closeLabel="Close field editor" onClose={onClose}>
      <FieldEditorSidebarPanel field={field} disabled={disabled} />
    </SidePanel>
  );
}

function FieldEditorSidebarPanel({
  field,
  disabled,
}: {
  field: FieldDefinition;
  disabled: boolean;
}) {
  const updateField = useUpdateCustomField();

  const saveUpdate = useCallback(
    (payload: { title?: string; config?: FieldDefinition["config"] }) => {
      void updateField
        .mutateAsync({ fieldId: field.id, ...payload })
        .catch((caught) => {
          toast.error((caught as Error)?.message ?? "Could not update field.");
        });
    },
    [field.id, updateField],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <FieldTitleSection
        title={field.title}
        disabled={disabled}
        onChange={(title) => saveUpdate({ title })}
      />

      <section className="grid gap-3 border-b border-border/70 px-3 py-3">
        <FieldConfigControl
          type={field.type}
          config={field.config}
          disabled={disabled}
          onChange={(config) => saveUpdate({ config })}
        />
      </section>
    </div>
  );
}
