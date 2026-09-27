import {
  ActionButton,
  Skeleton,
  TextArea,
} from "@agent-native/toolkit/design-system";
import { IconInfoCircle } from "@tabler/icons-react";
import { useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import {
  useCreateResource,
  useResource,
  useResources,
  useUpdateResource,
  type ResourceMeta,
} from "../resources/use-resources.js";

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
      <div className="max-w-3xl space-y-6" aria-busy="true">
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

  const help = (content: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={content}
        >
          <IconInfoCircle size={16} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );

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
    <div className="max-w-3xl space-y-7">
      <section className="space-y-2">
        <div className="flex items-center gap-1">
          <label
            htmlFor="agent-personal-instructions"
            className="text-sm font-medium text-foreground"
          >
            {labels.customInstructions}
          </label>
          {help(labels.customInstructionsHelp)}
        </div>
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
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1">
          <label
            htmlFor="agent-personal-memory-instructions"
            className="text-sm font-medium text-foreground"
          >
            {labels.memoryInstructions}
          </label>
          {help(labels.memoryInstructionsHelp)}
        </div>
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
      </section>
    </div>
  );
}
