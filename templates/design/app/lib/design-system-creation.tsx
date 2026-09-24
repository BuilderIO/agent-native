import { callAction, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  DesignSystemWorkspaceSnapshot,
  StartDesignSystemAuthoringInput,
  UpdateDesignSystemWorkspaceInput,
} from "@agent-native/core/shared/design-system-authoring";
import type {
  CreateDesignSystemInput,
  DesignSystemSourceBatch,
} from "@agent-native/toolkit/design-system-creation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";

export const creationComponents = {
  Badge,
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Spinner,
};

export function useDesignSystemCreationActions(
  originDraft?: StartDesignSystemAuthoringInput["originDraft"],
) {
  const t = useT();
  const create = useActionMutation<
    DesignSystemWorkspaceSnapshot,
    StartDesignSystemAuthoringInput
  >("start-design-system-authoring");
  const update = useActionMutation<
    DesignSystemWorkspaceSnapshot,
    UpdateDesignSystemWorkspaceInput
  >("update-design-system-workspace");
  return {
    onCreate: async ({ name, ...input }: CreateDesignSystemInput) => {
      const snapshot = await create.mutateAsync({
        ...input,
        title: name,
        originDraft,
      });
      return { systemId: snapshot.id, title: snapshot.title, snapshot };
    },
    onAddSources: async (systemId: string, batch: DesignSystemSourceBatch) => {
      const snapshot = await callAction<DesignSystemWorkspaceSnapshot>(
        "get-design-system-workspace",
        { id: systemId },
      );
      if (!snapshot.workspace || !snapshot.canEdit)
        throw new Error(t("systemCreation.editUnavailable"));
      await update.mutateAsync({
        id: systemId,
        expectedRevision: snapshot.workspace.revision,
        operationId: batch.requestId,
        sources: batch.sources,
      });
    },
  };
}
