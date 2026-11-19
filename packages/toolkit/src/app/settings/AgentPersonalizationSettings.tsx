import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateResource,
  useResource,
  useResources,
  useUpdateResource,
  type Resource,
  type ResourceMeta,
} from "@agent-native/core/client/resources/use-resources";
import {
  SAVE_CONFLICT_ERROR_CODE,
  saveRevisionOf,
  saveWithMerge,
  type SavedRecord,
} from "@agent-native/core/save-conflict";
import {
  ActionButton,
  Skeleton,
  TextArea,
} from "@agent-native/toolkit/design-system";
import { useRef, useState } from "react";

import { useSaveConflictPrompt } from "../save-conflict.js";
import { SettingsGroup } from "./SettingsRow.js";

type Field = "instructions" | "memory";

interface InstructionsContent {
  content: string;
}

function resourceAtPath(
  resources: ResourceMeta[] | undefined,
  path: string,
): ResourceMeta | undefined {
  return resources?.find((resource) => resource.path === path);
}

function savedRecord(
  resource: Pick<Resource, "content" | "revision"> | undefined,
): SavedRecord<InstructionsContent> {
  return resource
    ? {
        value: { content: resource.content },
        revision: resource.revision ?? null,
      }
    : { value: { content: "" }, revision: null };
}

function createdMeanwhile(content: string): Error {
  return Object.assign(new Error("The file was created meanwhile"), {
    errorCode: SAVE_CONFLICT_ERROR_CODE,
    details: {
      current: { content },
      currentRevision: saveRevisionOf({ content }),
    },
  });
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
  const bases = useRef<
    Partial<Record<Field, SavedRecord<InstructionsContent>>>
  >({});
  const createdIds = useRef<Partial<Record<Field, string>>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [failedField, setFailedField] = useState<string | null>(null);

  const instructionsValue =
    instructionsDraft ?? instructions.data?.content ?? "";
  const memoryValue = memoryDraft ?? memoryInstructions.data?.content ?? "";
  const loading =
    resourceList.isPending ||
    (Boolean(instructionsMeta) &&
      instructions.isPending &&
      instructionsDraft === null) ||
    (Boolean(memoryInstructionsMeta) &&
      memoryInstructions.isPending &&
      memoryDraft === null);
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

  const startDraft = (field: Field) => {
    if (bases.current[field]) return;
    bases.current[field] = savedRecord(
      field === "instructions" ? instructions.data : memoryInstructions.data,
    );
  };

  const fields = {
    instructions: {
      path: "AGENTS.md",
      resource: instructionsMeta,
      value: instructionsValue,
      setDraft: setInstructionsDraft,
    },
    memory: {
      path: "memory/INSTRUCTIONS.md",
      resource: memoryInstructionsMeta,
      value: memoryValue,
      setDraft: setMemoryDraft,
    },
  };

  const saveNow = async (field: Field, content: string) => {
    const { path, resource, setDraft } = fields[field];
    setSavedField(null);
    setFailedField(null);
    setSavingField(field);
    try {
      const base = bases.current[field] ?? savedRecord(undefined);
      let id =
        base.revision === null
          ? undefined
          : (resource?.id ?? createdIds.current[field]);
      const saved = await saveWithMerge<InstructionsContent>({
        base,
        mine: { content },
        resolveOverlap: conflicts[field].resolveOverlap,
        save: async ({ value, revision }) => {
          if (id) {
            const result = await updateResource.mutateAsync({
              id,
              content: value.content,
              expectedRevision: revision ?? undefined,
            });
            return savedRecord(result);
          }
          const result = await createResource.mutateAsync({
            path,
            content: value.content,
            mimeType: "text/markdown",
            ifNotExists: true,
          });
          id = result.id;
          createdIds.current[field] = result.id;
          if (result.content !== value.content) {
            throw createdMeanwhile(result.content);
          }
          return {
            value: { content: result.content },
            revision:
              result.revision ?? saveRevisionOf({ content: result.content }),
          };
        },
      });
      bases.current[field] = saved;
      savedContents.current[field] = saved.value.content;
      setSavedField(field);
      setDraft(saved.value.content);
    } catch {
      setFailedField(field);
    } finally {
      setSavingField(null);
    }
  };

  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const save = (field: Field, content: string) => {
    const next = saveQueue.current.then(() => saveNow(field, content));
    saveQueue.current = next;
    return next;
  };

  const restore =
    (field: Field) =>
    (restoreOnto: (current: InstructionsContent) => InstructionsContent) => {
      const { content } = restoreOnto({ content: fields[field].value });
      fields[field].setDraft(content);
      void save(field, content);
    };
  const conflicts = {
    instructions: useSaveConflictPrompt<InstructionsContent>({
      record: "resource_content",
      onRestore: restore("instructions"),
    }),
    memory: useSaveConflictPrompt<InstructionsContent>({
      record: "resource_content",
      onRestore: restore("memory"),
    }),
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
              startDraft("instructions");
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
              onPress={() => void save("instructions", instructionsValue)}
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
              startDraft("memory");
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
              onPress={() => void save("memory", memoryValue)}
            >
              {savingField === "memory" ? labels.saving : labels.save}
            </ActionButton>
            {renderSaveStatus("memory")}
          </div>
        </div>
      </SettingsGroup>
      {conflicts.instructions.prompt}
      {conflicts.memory.prompt}
    </div>
  );
}
