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
} from "@agent-native/toolkit/app/chat/composer/index";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@agent-native/toolkit/ui/select";
import { isCodeAgentModelConfigured } from "@shared/code-agent-readiness";
import { IconFolder, IconFolderPlus } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import DesktopAiSetupCard from "./DesktopAiSetupCard.js";

import "./QuickPromptOverlay.css";

type QuickPromptOverlayProps = {
  onSubmit: (
    prompt: string,
    attachments: CodeAgentPromptAttachment[],
    cwd?: string,
    modelSelection?: CodeAgentModelSelectionType,
  ) => Promise<void>;
  onDismiss: () => void;
  submitting?: boolean;
};

function preferConfiguredModelSelection(
  current: CodeAgentModelSelectionType,
  models: CodeAgentModelOption[],
  fallback?: { engine?: string; model?: string },
): CodeAgentModelSelectionType {
  if (isCodeAgentModelConfigured(models, current)) return current;
  if (!fallback || !isCodeAgentModelConfigured(models, fallback))
    return current;
  return {
    engine: fallback.engine,
    model: fallback.model,
    effort: current.effort,
  };
}

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
  const canChoose = Boolean(
    window.electronAPI?.codeAgents &&
    "chooseProject" in window.electronAPI.codeAgents,
  );
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
  const [modelListUnavailable, setModelListUnavailable] = useState(false);
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
    const api = window.electronAPI?.codeAgents;
    if (!api) return;
    let mounted = true;
    const refreshModelsOnFocus = () => {
      void api
        .listModels()
        .then((result) => {
          if (!mounted) return;
          setModelListUnavailable(result.status !== "ok");
          const models = result.status === "ok" ? result.models : [];
          setModelOptions(models);
          if (result.status === "ok") {
            setModelSelection((current) =>
              preferConfiguredModelSelection(current, models, result.selected),
            );
          }
        })
        .catch(() => {
          if (!mounted) return;
          setModelListUnavailable(true);
          setModelOptions([]);
        });
    };
    window.addEventListener("focus", refreshModelsOnFocus);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshModelsOnFocus);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const api = window.electronAPI?.codeAgents;
    if (!api) {
      setModelListUnavailable(true);
      setModelListLoading(false);
      return;
    }

    void api
      .listModels()
      .then((result) => {
        if (!mounted) return;
        if (result.status === "ok") {
          setModelOptions(result.models);
          setModelListUnavailable(false);
          setModelSelection((current) => {
            if (current.engine && current.model) {
              return preferConfiguredModelSelection(
                current,
                result.models,
                result.selected,
              );
            }
            return preferConfiguredModelSelection(
              current,
              result.models,
              result.selected,
            );
          });
        } else {
          setModelOptions([]);
          setModelListUnavailable(true);
        }
        setModelListLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setModelOptions([]);
        setModelListUnavailable(true);
        setModelListLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const setupRequired =
    !modelListLoading &&
    (modelListUnavailable ||
      !isCodeAgentModelConfigured(modelOptions, normalizedModelSelection));

  useEffect(() => {
    window.electronAPI?.quickPrompt.setSetupRequired(setupRequired);
  }, [setupRequired]);

  const verifySelectedProvider = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api) {
      setModelListUnavailable(true);
      return false;
    }

    try {
      const result = await api.listModels({ refresh: true });
      if (result.status !== "ok") {
        setModelListUnavailable(true);
        return false;
      }
      setModelOptions(result.models);
      setModelListUnavailable(false);
      const selectedModel = preferConfiguredModelSelection(
        normalizedModelSelection,
        result.models,
        result.selected,
      );
      setModelSelection(selectedModel);
      return isCodeAgentModelConfigured(result.models, selectedModel);
    } catch {
      setModelListUnavailable(true);
      return false;
    }
  }, [normalizedModelSelection.engine, normalizedModelSelection.model]);

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

  useEffect(() => {
    const unsubscribe = window.electronAPI?.quickPrompt.onHidden(() => {
      setModelPickerOpen(false);
    });
    return unsubscribe;
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
        throw error;
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
      }${setupRequired ? " quick-prompt-overlay--setup-required" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Prompt"
      onMouseDown={handleBackdropMouseDown}
    >
      {setupRequired ? (
        <DesktopAiSetupCard
          onOpenSettings={() =>
            window.electronAPI?.quickPrompt.openProviderSettings()
          }
          statusUnavailable={modelListUnavailable}
        />
      ) : null}
      <PromptComposer
        autoFocus
        attachmentsEnabled
        className="quick-prompt-overlay__composer"
        composerRef={composerRef}
        disabled={submitting || localSubmitting || setupRequired}
        draftScope="desktop:quick-prompt"
        layoutVariant="hero"
        placeholder="Ask anything…"
        showModelSelector
        showAutoModelOption={false}
        availableAgents={availableAgents}
        availableModels={availableModels}
        modelListLoading={modelListLoading}
        modelSelectorOpen={modelPickerOpen}
        selectedAgent={getCodeAgentIdForEngine(normalizedModelSelection.engine)}
        selectedEngine={normalizedModelSelection.engine}
        selectedEffort={normalizedModelSelection.effort}
        selectedModel={normalizedModelSelection.model}
        onAgentChange={handleAgentChange}
        onConnectLocalRuntime={handleConnectLocalRuntime}
        onEffortChange={handleEffortChange}
        onModelChange={handleModelChange}
        onModelSelectorOpenChange={handleModelPickerOpenChange}
        onBeforeSubmit={verifySelectedProvider}
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
