import {
  PromptComposer,
  readAgentPromptAttachment,
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
  const effectiveProjectPath = selectedProjectPath || projects[0]?.path || "";

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
    async (text: string, files: File[]) => {
      const prompt = text.trim();
      setSubmitError(null);
      setLocalSubmitting(true);
      try {
        const attachments = await Promise.all(
          files.map((file) => readAgentPromptAttachment(file)),
        );
        await onSubmit(prompt, attachments, effectiveProjectPath || undefined);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : String(error));
      } finally {
        setLocalSubmitting(false);
      }
    },
    [effectiveProjectPath, onSubmit],
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
      className="quick-prompt-overlay"
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
        showModelSelector={false}
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
