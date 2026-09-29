import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateResource,
  useResource,
  useResources,
  useUpdateResource,
  type ResourceMeta,
} from "@agent-native/core/client/resources/use-resources";
import {
  ActionButton,
  Skeleton,
  TextArea,
} from "@agent-native/toolkit/design-system";
import { useRef, useState } from "react";

import { SettingsGroup } from "./SettingsRow.js";

function resourceAtPath(
  resources: ResourceMeta[] | undefined,
  path: string,
): ResourceMeta | undefined {
  return resources?.find((resource) => resource.path === path);
}

export function AgentPersonalizationSettings() {
  const t = useT();
  const resourceList = useResources("personal");
  const instructionsMeta = resourceAtPath(resourceList.data, "AGENTS.md");
  const memoryInstructionsMeta = resourceAtPath(
    resourceList.data,
    "memory/INSTRUCTIONS.md",
  );
  const instructions = useResource(instructionsMeta?.id ?? null);
  const memoryInstructions = useResource(memoryInstructionsMeta?.id ?? null);
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(
    null,
  );
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null);
  const savedContents = useRef<{ instructions?: string; memory?: string }>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [failedField, setFailedField] = useState<string | null>(null);

  const instructionsValue =
    instructionsDraft ?? instructions.data?.content ?? "";
  const memoryValue = memoryDraft ?? memoryInstructions.data?.content ?? "";
  const loading =
    resourceList.isPending ||
    (Boolean(instructionsMeta) && instructions.isPending) ||
    (Boolean(memoryInstructionsMeta) && memoryInstructions.isPending);
  const hasLoadError =
    resourceList.isError || instructions.isError || memoryInstructions.isError;
  const saving = savingField !== null;
  const canSaveInstructions =
    Boolean(instructionsDraft !== null) &&
    instructionsValue !==
      (instructions.data?.content ?? savedContents.current.instructions ?? "");
  const canSaveMemory =
    Boolean(memoryDraft !== null) &&
    memoryValue !==
      (memoryInstructions.data?.content ?? savedContents.current.memory ?? "");

  const save = async (input: {
    field: "instructions" | "memory";
    path: string;
    resource: ResourceMeta | undefined;
    content: string;
  }) => {
    setSavedField(null);
    setFailedField(null);
    setSavingField(input.field);
    try {
      const saved = input.resource
        ? await updateResource.mutateAsync({
            id: input.resource.id,
            content: input.content,
          })
        : await createResource.mutateAsync({
            path: input.path,
            content: input.content,
            mimeType: "text/markdown",
          });
      savedContents.current[input.field] = saved.content;
      setSavedField(input.field);
      if (input.field === "instructions") setInstructionsDraft(saved.content);
      else setMemoryDraft(saved.content);
    } catch {
      setFailedField(input.field);
    } finally {
      setSavingField(null);
    }
  };

  const labels = {
    customInstructions: t("agentChat.personalization.customInstructions"),
    customInstructionsHelp: t(
      "agentChat.personalization.customInstructionsHelp",
    ),
    memoryInstructions: t("agentChat.personalization.memoryInstructions"),
    memoryInstructionsHelp: t(
      "agentChat.personalization.memoryInstructionsHelp",
    ),
    save: t("agentChat.common.save"),
    saving: t("agentChat.common.saving"),
    saved: t("agentChat.personalization.saved"),
    saveFailed: t("agentChat.common.saveFailed"),
    loadFailed: t("agentChat.common.chunkLoadFailed"),
    instructionsPlaceholder: t(
      "agentChat.personalization.customInstructionsPlaceholder",
    ),
    memoryPlaceholder: t(
      "agentChat.personalization.memoryInstructionsPlaceholder",
    ),
  };

  if (loading) {
    return (
      <div className="w-full space-y-6" aria-busy="true">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    );
  }

  if (hasLoadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {labels.loadFailed}
      </p>
    );
  }

  const renderSaveStatus = (field: string) => {
    if (failedField === field) {
      return (
        <span className="text-sm text-destructive" role="alert">
          {labels.saveFailed}
        </span>
      );
    }
    if (savedField === field) {
      return (
        <span className="text-sm text-muted-foreground" role="status">
          {labels.saved}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="w-full space-y-7">
      <SettingsGroup
        title={labels.customInstructions}
        description={labels.customInstructionsHelp}
      >
        <div className="space-y-2 px-5 py-4 sm:px-6">
          <TextArea
            id="agent-personal-instructions"
            aria-label={labels.customInstructions}
            value={instructionsValue}
            onChange={(value) => {
              setInstructionsDraft(value);
              setSavedField(null);
              setFailedField(null);
            }}
            placeholder={labels.instructionsPlaceholder}
            rows={8}
            className="resize-y text-sm"
            disabled={saving}
          />
          <div className="flex min-h-9 items-center gap-3">
            <ActionButton
              type="button"
              emphasis="solid"
              disabled={!canSaveInstructions || saving}
              onPress={() =>
                void save({
                  field: "instructions",
                  path: "AGENTS.md",
                  resource: instructionsMeta,
                  content: instructionsValue,
                })
              }
            >
              {savingField === "instructions" ? labels.saving : labels.save}
            </ActionButton>
            {renderSaveStatus("instructions")}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={labels.memoryInstructions}
        description={labels.memoryInstructionsHelp}
      >
        <div className="space-y-2 px-5 py-4 sm:px-6">
          <TextArea
            id="agent-personal-memory-instructions"
            aria-label={labels.memoryInstructions}
            value={memoryValue}
            onChange={(value) => {
              setMemoryDraft(value);
              setSavedField(null);
              setFailedField(null);
            }}
            placeholder={labels.memoryPlaceholder}
            rows={5}
            className="resize-y text-sm"
            disabled={saving}
          />
          <div className="flex min-h-9 items-center gap-3">
            <ActionButton
              type="button"
              emphasis="solid"
              disabled={!canSaveMemory || saving}
              onPress={() =>
                void save({
                  field: "memory",
                  path: "memory/INSTRUCTIONS.md",
                  resource: memoryInstructionsMeta,
                  content: memoryValue,
                })
              }
            >
              {savingField === "memory" ? labels.saving : labels.save}
            </ActionButton>
            {renderSaveStatus("memory")}
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
