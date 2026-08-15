import {
  getCodeAgentIdForEngine,
  getCodeAgentPickerOptions,
  getCodeAgentSelection,
  groupCodeAgentModelOptions,
  normalizeModelSelection,
  readCodeAgentModelSelection,
  writeCodeAgentModelSelection,
  type CodeAgentModelOption,
  type CodeAgentModelSelection as CodeAgentModelSelectionType,
} from "@agent-native/code-agents-ui";
import {
  PromptComposer,
  readAgentPromptAttachment,
  type PromptComposerSubmitOptions,
  type TiptapComposerHandle,
} from "@agent-native/core/client/composer";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@agent-native/toolkit/ui/select";
import { IconFolder, IconFolderPlus } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import "./QuickPromptOverlay.css";

type QuickPromptOverlayProps = {
  onSubmit(
    prompt: string,
    attachments: CodeAgentPromptAttachment[],
    cwd?: string,
    modelSelection?: CodeAgentModelSelectionType,
  ): Promise<void>;
  onDismiss(): void;
  submitting?: boolean;
};

function resolveProjectSelection(result: CodeAgentProjectListResult): string {
  const candidates = [result.selectedPath, result.defaultPath];
  return (
    candidates.find((candidate) =>
      candidate
        ? result.projects.some((project) => project.path === candidate)
        : false,
    ) ??
    result.projects[0]?.path ??
    ""
  );
}

function QuickPromptProjectPicker({
  projects,
  selectedPath,
  loading,
  onSelect,
  onChoose,
}: {
  projects: CodeAgentProjectFolder[];
  selectedPath: string;
  loading: boolean;
  onSelect: (path: string) => void;
  onChoose: () => void;
}) {
  const canChoose = Boolean(window.electronAPI?.codeAgents?.chooseProject);
  const effectiveSelectedPath = selectedPath || projects[0]?.path || "";
  const activeProject = projects.find(
    (project) => project.path === effectiveSelectedPath,
  );

  return (
    <Select
      value={effectiveSelectedPath || undefined}
      disabled={loading || (projects.length === 0 && !canChoose)}
      onValueChange={(value) => {
        if (value === "__choose__") {
          onChoose();
          return;
        }
        onSelect(value);
      }}
    >
      <SelectTrigger
        className="quick-prompt-project-picker__trigger"
        aria-label="Select project folder"
      >
        <IconFolder size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="quick-prompt-project-picker__value">
          {activeProject?.name ??
            (loading ? "Loading project…" : "Select project")}
        </span>
      </SelectTrigger>
      <SelectContent className="quick-prompt-project-picker__content">
        <SelectGroup>
          {projects.map((project) => (
            <SelectItem key={project.path} value={project.path}>
              <span className="quick-prompt-project-picker__item">
                <IconFolder size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>{project.name}</span>
              </span>
            </SelectItem>
          ))}
          {canChoose ? (
            <SelectItem value="__choose__">
              <span className="quick-prompt-project-picker__item">
                <IconFolderPlus
                  size={14}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <span>Add project folder…</span>
              </span>
            </SelectItem>
          ) : null}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function useComposerFocus() {
  const composerRef = useRef<TiptapComposerHandle>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      composerRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  return composerRef;
}

export default function QuickPromptOverlay({
  onSubmit,
  onDismiss,
  submitting = false,
}: QuickPromptOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useComposerFocus();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [projects, setProjects] = useState<CodeAgentProjectFolder[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState("");
  const [projectLoading, setProjectLoading] = useState(true);
  const [modelOptions, setModelOptions] = useState<CodeAgentModelOption[]>([]);
  const [modelListLoading, setModelListLoading] = useState(true);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSelection, setModelSelection] =
    useState<CodeAgentModelSelectionType>(() => readCodeAgentModelSelection());
  const effectiveProjectPath = selectedProjectPath || projects[0]?.path || "";
  const normalizedModelSelection = useMemo(
    () => normalizeModelSelection(modelSelection, modelOptions),
    [modelOptions, modelSelection],
  );
  const availableModels = useMemo(
    () => groupCodeAgentModelOptions(modelOptions),
    [modelOptions],
  );
  const availableAgents = useMemo(
    () => getCodeAgentPickerOptions(modelOptions),
    [modelOptions],
  );

  useEffect(() => {
    let mounted = true;
    const api = window.electronAPI?.codeAgents;
    if (!api) {
      setProjectLoading(false);
      return;
    }

    void api
      .listProjects()
      .then((result) => {
        if (!mounted) return;
        setProjects(result.projects);
        setSelectedProjectPath(resolveProjectSelection(result));
        setProjectLoading(false);
      })
      .catch(() => {
        if (mounted) setProjectLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const api = window.electronAPI?.codeAgents;
    if (!api) {
      setModelListLoading(false);
      return;
    }

    void api
      .listModels()
      .then((result) => {
        if (!mounted) return;
        if (result.status === "ok") {
          setModelOptions(result.models);
          setModelSelection((current) => {
            if (current.engine && current.model) return current;
            if (!result.selected) return current;
            return {
              engine: result.selected.engine,
              model: result.selected.model,
              effort: result.selected.effort as
                | CodeAgentModelSelectionType["effort"]
                | undefined,
            };
          });
        } else {
          setModelOptions([]);
        }
        setModelListLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setModelOptions([]);
        setModelListLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (modelListLoading || modelOptions.length === 0) return;
    writeCodeAgentModelSelection(normalizedModelSelection);
  }, [modelListLoading, modelOptions.length, normalizedModelSelection]);

  const handleModelChange = useCallback(
    (model: string, engine: string) => {
      setModelSelection((current) => ({
        engine,
        model,
        effort: current.effort ?? normalizedModelSelection.effort,
      }));
    },
    [normalizedModelSelection.effort],
  );

  const handleAgentChange = useCallback(
    (agent: string) => {
      setModelSelection((current) =>
        getCodeAgentSelection(
          agent,
          normalizeModelSelection(current, modelOptions),
          modelOptions,
        ),
      );
    },
    [modelOptions],
  );

  const handleEffortChange = useCallback((effort: string) => {
    setModelSelection((current) => ({
      ...current,
      effort: effort as CodeAgentModelSelectionType["effort"],
    }));
  }, []);

  const handleModelPickerOpenChange = useCallback((open: boolean) => {
    setModelPickerOpen(open);
    window.electronAPI?.quickPrompt.setPickerOpen(open);
  }, []);

  const handleConnectLocalRuntime = useCallback((engine: string) => {
    const api = window.electronAPI?.codeAgents;
    if (!api) return;
    if (engine === "codex-cli") {
      void api.openCodexLogin();
      return;
    }
    void api.openTerminal();
  }, []);

  const handleProjectSelect = useCallback(async (path: string) => {
    setSelectedProjectPath(path);
    const api = window.electronAPI?.codeAgents;
    if (!api) return;
    const result = await api.selectProject(path);
    if (result.ok) {
      setProjects(result.projects);
      setSelectedProjectPath(result.selectedPath ?? path);
    }
  }, []);

  const handleProjectChoose = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api) return;
    const result = await api.chooseProject();
    if (!result.ok) return;
    setProjects(result.projects);
    setSelectedProjectPath(result.selectedPath ?? result.project?.path ?? "");
  }, []);

  const handleSubmit = useCallback(
    async (
      text: string,
      files: File[],
      _references: unknown[],
      options: PromptComposerSubmitOptions,
    ) => {
      const prompt = text.trim();
      setSubmitError(null);
      setLocalSubmitting(true);
      try {
        const attachments = await Promise.all(
          files.map((file) => readAgentPromptAttachment(file)),
        );
        await onSubmit(prompt, attachments, effectiveProjectPath || undefined, {
          engine: options.engine ?? normalizedModelSelection.engine,
          model: options.model ?? normalizedModelSelection.model,
          effort: options.effort ?? normalizedModelSelection.effort,
        });
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : String(error));
      } finally {
        setLocalSubmitting(false);
      }
    },
    [effectiveProjectPath, normalizedModelSelection, onSubmit],
  );

  const handleBackdropMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onDismiss();
    },
    [onDismiss],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onDismiss]);

  useEffect(() => {
    const node = overlayRef.current;
    if (!node) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target === node) onDismiss();
    };

    node.addEventListener("pointerdown", onPointerDown);
    return () => node.removeEventListener("pointerdown", onPointerDown);
  }, [onDismiss]);

  return (
    <div
      ref={overlayRef}
      className={`quick-prompt-overlay${
        modelPickerOpen ? " quick-prompt-overlay--picker-open" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Prompt"
      onMouseDown={handleBackdropMouseDown}
    >
      <PromptComposer
        autoFocus
        attachmentsEnabled
        className="quick-prompt-overlay__composer"
        composerRef={composerRef}
        disabled={submitting || localSubmitting}
        initialText=""
        layoutVariant="hero"
        placeholder="Ask anything…"
        showModelSelector
        showAutoModelOption={false}
        availableAgents={availableAgents}
        availableModels={availableModels}
        modelListLoading={modelListLoading}
        modelStatusChecksEnabled={false}
        selectedAgent={getCodeAgentIdForEngine(normalizedModelSelection.engine)}
        selectedEngine={normalizedModelSelection.engine}
        selectedEffort={normalizedModelSelection.effort}
        selectedModel={normalizedModelSelection.model}
        onAgentChange={handleAgentChange}
        onConnectLocalRuntime={handleConnectLocalRuntime}
        onEffortChange={handleEffortChange}
        onModelChange={handleModelChange}
        onModelSelectorOpenChange={handleModelPickerOpenChange}
        toolbarSlot={
          <QuickPromptProjectPicker
            loading={projectLoading}
            onChoose={handleProjectChoose}
            onSelect={(path) => void handleProjectSelect(path)}
            projects={projects}
            selectedPath={selectedProjectPath}
          />
        }
        voiceEnabled={false}
        onSubmit={handleSubmit}
      />
      {submitError ? (
        <p className="quick-prompt-overlay__error" role="status">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}
