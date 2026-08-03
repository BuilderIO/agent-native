import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { openAgentSidebar } from "@agent-native/core/client/navigation";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@agent-native/toolkit/app-shell";
import {
  IconArrowLeft,
  IconBrandGithub,
  IconBrandFigma,
  IconUpload,
  IconFolder,
  IconX,
  IconWorld,
  IconFileDescription,
  IconPhoto,
  IconPalette,
  IconCheck,
  IconExternalLink,
  IconChevronDown,
} from "@tabler/icons-react";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  uploadAndIndexFigmaFiles,
  pollDecodeJobStatus,
  type DecodeJobStatus,
} from "@/lib/builder-design-system-upload";
import { cn } from "@/lib/utils";

interface GitHubLink {
  id: string;
  url: string;
}

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  textContent?: string;
}

type OtherSource = "brand" | "code" | "files" | "existing" | "notes";

interface BuilderIndexResult {
  ok: boolean;
  source: "builder";
  suggestedTitle: string;
  projectId: string;
  jobId: string;
  designSystemId: string;
  builderUrl: string;
  status: "in-progress";
  localDesignSystemId?: string;
  uploadedFileCount?: number;
  instructions?: string;
}

export default function DesignSystemSetup() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceId = searchParams.get("source") ?? "";

  const [companyInfo, setCompanyInfo] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLinks, setGithubLinks] = useState<GitHubLink[]>([]);
  const [codeFiles, setCodeFiles] = useState<UploadedFile[]>([]);
  const [docFiles, setDocFiles] = useState<UploadedFile[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadedFile[]>([]);
  const [assets, setAssets] = useState<UploadedFile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sourcePanel, setSourcePanel] = useState<"figma" | "other">("figma");
  const [otherSource, setOtherSource] = useState<OtherSource | null>(null);

  const docInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const appliedSourceIdRef = useRef<string | null>(null);

  const { data: designsData } = useActionQuery<{
    designs: Array<{ id: string; title: string; designSystemId?: string }>;
  }>("list-designs");

  const { data: designSystemsData } = useActionQuery<{
    designSystems: Array<{ id: string; title: string }>;
  }>("list-design-systems");
  const updateSystemMutation = useActionMutation("update-design-system");

  const existingProjects = designsData?.designs ?? [];
  const existingSystems = designSystemsData?.designSystems ?? [];

  // --- Figma .fig import (Builder design-system indexing) -----------------
  const realFigInputRef = useRef<HTMLInputElement>(null);
  const [builderIndexing, setBuilderIndexing] = useState(false);
  const [builderIndexResult, setBuilderIndexResult] =
    useState<BuilderIndexResult | null>(null);
  const [builderIndexError, setBuilderIndexError] = useState<string | null>(
    null,
  );
  const [decodeStatus, setDecodeStatus] = useState<DecodeJobStatus | null>(
    null,
  );
  const decodePollRef = useRef<AbortController | null>(null);

  const stopDecodePolling = useCallback(() => {
    decodePollRef.current?.abort();
    decodePollRef.current = null;
  }, []);

  useEffect(() => stopDecodePolling, [stopDecodePolling]);

  const startDecodePolling = useCallback(
    (jobId: string, indexResult: BuilderIndexResult) => {
      decodePollRef.current?.abort();
      const controller = new AbortController();
      decodePollRef.current = controller;
      setDecodeStatus({
        status: "pending",
        branchUrl: null,
        error: null,
        framesProcessed: 0,
        totalFrames: 0,
      });
      pollDecodeJobStatus(jobId, {
        signal: controller.signal,
        onUpdate: (status) => {
          if (!controller.signal.aborted) setDecodeStatus(status);
        },
      })
        .then((status) => {
          if (controller.signal.aborted) return;
          setDecodeStatus(status);
          setBuilderIndexResult(
            status.branchUrl
              ? { ...indexResult, builderUrl: status.branchUrl }
              : indexResult,
          );
          setBuilderIndexing(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setDecodeStatus((prev) => ({
            status: "error",
            branchUrl: prev?.branchUrl ?? null,
            error: err instanceof Error ? err.message : String(err),
            framesProcessed: prev?.framesProcessed ?? 0,
            totalFrames: prev?.totalFrames ?? 0,
          }));
          setBuilderIndexResult(indexResult);
          setBuilderIndexing(false);
        });
    },
    [],
  );

  const handleBuilderIndexUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".fig")) {
        setBuilderIndexError(t("designSystemSetup.errors.chooseFig"));
        return;
      }
      setBuilderIndexError(null);
      setBuilderIndexResult(null);
      stopDecodePolling();
      setDecodeStatus(null);
      setBuilderIndexing(true);
      try {
        const suggestedTitle =
          file.name
            .replace(/\.fig$/i, "")
            .replace(/[-_]+/g, " ")
            .trim() || "Imported brand";
        const json = await uploadAndIndexFigmaFiles([file], {
          projectName: companyInfo.trim() || suggestedTitle,
        });
        const parsed = json as unknown as BuilderIndexResult;
        if (parsed.jobId) {
          startDecodePolling(parsed.jobId, parsed);
        } else {
          setBuilderIndexResult(parsed);
          setBuilderIndexing(false);
        }
      } catch (err) {
        setBuilderIndexError(
          err instanceof Error
            ? err.message
            : t("designSystemSetup.errors.parseFig"),
        );
        setBuilderIndexing(false);
      }
    },
    [companyInfo, t, startDecodePolling, stopDecodePolling],
  );

  useEffect(() => {
    if (!sourceId || appliedSourceIdRef.current === sourceId) return;
    const sourceExists =
      existingSystems.some((system) => system.id === sourceId) ||
      existingProjects.some((project) => project.id === sourceId);
    if (!sourceExists) return;
    setSelectedProjectId(sourceId);
    appliedSourceIdRef.current = sourceId;
  }, [sourceId, existingProjects, existingSystems]);

  const hasAnySources = useMemo(() => {
    return (
      companyInfo.trim() ||
      websiteUrl.trim() ||
      websiteUrls.length > 0 ||
      githubUrl.trim() ||
      githubLinks.length > 0 ||
      codeFiles.length > 0 ||
      builderIndexResult ||
      docFiles.length > 0 ||
      imageFiles.length > 0 ||
      assets.length > 0 ||
      selectedProjectId ||
      notes.trim() ||
      customInstructions.trim()
    );
  }, [
    companyInfo,
    websiteUrl,
    websiteUrls,
    githubUrl,
    githubLinks,
    codeFiles,
    builderIndexResult,
    docFiles,
    imageFiles,
    assets,
    selectedProjectId,
    notes,
    customInstructions,
  ]);

  const selectOtherSource = useCallback((source: OtherSource) => {
    setSourcePanel("other");
    setOtherSource((current) => (current === source ? null : source));
  }, []);

  const addWebsiteUrl = useCallback(() => {
    const url = websiteUrl.trim();
    if (!url) {
      setValidationError(t("designSystemSetup.errors.enterWebsite"));
      return;
    }
    if (!isHttpUrl(url)) {
      setValidationError(t("designSystemSetup.errors.websiteProtocol"));
      return;
    }
    setWebsiteUrls((prev) => [...prev, url]);
    setWebsiteUrl("");
    setValidationError(null);
  }, [websiteUrl, t]);

  const addGithubLink = useCallback(() => {
    const url = githubUrl.trim();
    if (!url) {
      setValidationError(t("designSystemSetup.errors.enterGithub"));
      return;
    }
    if (!isGithubRepoUrl(url)) {
      setValidationError(t("designSystemSetup.errors.githubUrl"));
      return;
    }
    setGithubLinks((prev) => [...prev, { id: crypto.randomUUID(), url }]);
    setGithubUrl("");
    setValidationError(null);
  }, [githubUrl, t]);

  const removeGithubLink = useCallback((id: string) => {
    setGithubLinks((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const readTextFiles = useCallback(
    (
      fileList: FileList,
      setter: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
    ) => {
      const newFiles: UploadedFile[] = [];
      const promises: Promise<void>[] = [];

      Array.from(fileList).forEach((f) => {
        const file: UploadedFile = {
          id: crypto.randomUUID(),
          name: f.name,
          type: f.type,
          size: f.size,
        };

        if (
          f.size < 200 * 1024 &&
          (f.name.match(
            /\.(css|scss|sass|less|ts|tsx|js|jsx|json|html|svg|xml|md|markdown|mdx|txt)$/i,
          ) ||
            f.type.startsWith("text/"))
        ) {
          promises.push(
            f.text().then((text) => {
              file.textContent = text;
            }),
          );
        }

        newFiles.push(file);
      });

      Promise.all(promises).then(() => {
        setter((prev) => [...prev, ...newFiles]);
      });
    },
    [],
  );

  const handleCodeUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      readTextFiles(e.target.files, setCodeFiles);
      e.target.value = "";
    },
    [readTextFiles],
  );

  const handleDocUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const newFiles: UploadedFile[] = Array.from(e.target.files).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type || f.name.split(".").pop() || "",
        size: f.size,
      }));
      setDocFiles((prev) => [...prev, ...newFiles]);
      e.target.value = "";
    },
    [],
  );

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const newFiles: UploadedFile[] = Array.from(e.target.files).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type,
        size: f.size,
      }));
      setImageFiles((prev) => [...prev, ...newFiles]);
      e.target.value = "";
    },
    [],
  );

  const handleAssetUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const newAssets: UploadedFile[] = Array.from(e.target.files).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type,
        size: f.size,
      }));
      setAssets((prev) => [...prev, ...newAssets]);
      e.target.value = "";
    },
    [],
  );

  const handleFolderDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.dataTransfer.files) return;
      readTextFiles(e.dataTransfer.files, setCodeFiles);
    },
    [readTextFiles],
  );

  const handleContinue = useCallback(async () => {
    if (!hasAnySources) {
      setValidationError(t("designSystemSetup.errors.noSources"));
      return;
    }

    const pendingWebsiteUrl = websiteUrl.trim();
    const pendingGithubUrl = githubUrl.trim();
    if (pendingWebsiteUrl && !isHttpUrl(pendingWebsiteUrl)) {
      setValidationError(t("designSystemSetup.errors.websiteProtocol"));
      return;
    }
    if (pendingGithubUrl && !isGithubRepoUrl(pendingGithubUrl)) {
      setValidationError(t("designSystemSetup.errors.githubUrl"));
      return;
    }

    const normalizedWebsiteUrls = pendingWebsiteUrl
      ? [...websiteUrls, pendingWebsiteUrl]
      : websiteUrls;
    const normalizedGithubLinks = pendingGithubUrl
      ? [...githubLinks, { id: "pending", url: pendingGithubUrl }]
      : githubLinks;
    const readableCodeFiles = codeFiles.filter((f) => f.textContent);
    const designMdFiles = readableCodeFiles.filter(isDesignMdFile);
    const builderCodeFiles = readableCodeFiles.filter(
      (file) => !isDesignMdFile(file),
    );
    const unreadableCodeFiles = codeFiles.filter((f) => !f.textContent);

    const parts: string[] = [];
    parts.push(
      "Set up a design system from the following sources. Use Builder Design System Intelligence (DSI) as the source of truth for reusable Figma/code/design.md indexing. Analyze each source, extract design tokens (colors, fonts, spacing, borders), and create a cohesive design system.",
    );

    if (companyInfo.trim()) {
      parts.push(
        `\n## Company / Brand\n${companyInfo.trim()}\n\nUse exactly this as the design system name. Never replace it with the uploaded Figma filename.`,
      );
    }

    if (normalizedWebsiteUrls.length > 0) {
      parts.push(
        `\n## Website URLs\nExtract design tokens from these websites:\n${normalizedWebsiteUrls.map((u) => `- ${u}`).join("\n")}\n\n**Best approach:** Call \`activate-browser\` first, then use chrome-devtools MCP tools to navigate each URL and extract computed styles (colors, fonts, spacing, CSS custom properties) via \`evaluate_script\`. This captures the real rendered design — including JS-injected styles, CSS-in-JS, and SPA content that plain HTML fetch misses. Take a screenshot too for visual reference. If Builder is not connected, fall back to \`import-from-url\` for each URL (limited to static HTML parsing).`,
      );
    }

    if (normalizedGithubLinks.length > 0) {
      parts.push(
        `\n## Connect Code: GitHub Repositories\nStart Builder DSI indexing for each repository with \`index-design-system-with-builder\`:\n${normalizedGithubLinks.map((l) => `- ${l.url}`).join("\n")}\n\nBuilder is the source of truth for repo/code design-system indexing. The action also creates a local selectable proxy design system for Design flows. If Builder is not connected, stop and tell me to connect Builder from Settings instead of asking me to paste repository credentials into chat.`,
      );
    }

    if (codeFiles.length > 0) {
      if (builderCodeFiles.length > 0) {
        parts.push(
          `\n## Connect Code: Code Files (${builderCodeFiles.length} files with content)\nStart Builder DSI indexing with \`index-design-system-with-builder\` using these files as the \`codeFiles\` argument:`,
        );
        for (const f of builderCodeFiles) {
          parts.push(
            `\n### ${f.name}\n\`\`\`\n${f.textContent!.slice(0, 5000)}\n\`\`\``,
          );
        }
      }
      if (designMdFiles.length > 0) {
        parts.push(
          `\n## Optional design.md (${designMdFiles.length} file${designMdFiles.length === 1 ? "" : "s"})\nPass this content as the \`designMd\` argument to \`index-design-system-with-builder\` alongside any Figma/code sources:`,
        );
        for (const f of designMdFiles) {
          parts.push(
            `\n### ${f.name}\n\`\`\`md\n${f.textContent!.slice(0, 5000)}\n\`\`\``,
          );
        }
      }
      if (unreadableCodeFiles.length > 0) {
        parts.push(
          `\nBinary code files (could not read):\n${unreadableCodeFiles.map((f) => `- ${f.name}`).join("\n")}`,
        );
      }
    }

    if (builderIndexResult) {
      parts.push(
        `\n## Connect Figma: Builder-Indexed Figma File\nBuilder DSI indexing has already started.\n- Design system: ${builderIndexResult.designSystemId}\n- Local selectable design system: ${builderIndexResult.localDesignSystemId ?? "(not returned)"}\n- Project: ${builderIndexResult.projectId}\n- Job: ${builderIndexResult.jobId}\n- URL: ${builderIndexResult.builderUrl}\n\nUse Builder as the source of truth for indexed tokens, assets, components, and guidance. Do not call \`create-design-system\` again for this Builder-indexed source.`,
      );
    }

    if (docFiles.length > 0) {
      parts.push(
        `\n## Documents\nExtract brand cues from these documents. Call \`import-document\` with metadata:\n${docFiles.map((f) => `- ${f.name} (${f.type}, ${formatSize(f.size)})`).join("\n")}`,
      );
    }

    if (imageFiles.length > 0) {
      parts.push(
        `\n## Visual References\nUse these images to inform the design system (color palette, typography, mood):\n${imageFiles.map((f) => `- ${f.name}`).join("\n")}`,
      );
    }

    if (assets.length > 0) {
      parts.push(
        `\n## Brand Assets (logos, fonts, etc.)\n${assets.map((a) => `- ${a.name} (${a.type})`).join("\n")}`,
      );
    }

    if (selectedProjectId) {
      const project = existingProjects.find((p) => p.id === selectedProjectId);
      const system = existingSystems.find((s) => s.id === selectedProjectId);
      if (project) {
        parts.push(
          `\n## Import from Existing Project\nExtract design tokens from "${project.title}". Call \`import-design-project --designId ${selectedProjectId}\``,
        );
      } else if (system) {
        parts.push(
          `\n## Fork Existing Design System\nClone "${system.title}" as a starting point. Call \`import-design-project --designId _ --designSystemId ${selectedProjectId}\``,
        );
      }
    }

    if (notes.trim()) {
      parts.push(`\n## Additional Notes\n${notes.trim()}`);
    }

    if (customInstructions.trim()) {
      parts.push(
        `\n## Custom Instructions (durable — store on the design system)\nIf you create a local design system from non-Builder sources, pass these verbatim as the \`customInstructions\` argument. They will be re-applied every time the design system is used to generate a design:\n\n${customInstructions.trim()}`,
      );
    }

    const requestedTitle = companyInfo.trim();
    const localDesignSystemId = builderIndexResult?.localDesignSystemId;
    if (requestedTitle && localDesignSystemId) {
      try {
        await updateSystemMutation.mutateAsync({
          id: localDesignSystemId,
          title: requestedTitle,
        });
      } catch (error) {
        toast.error(t("common.genericError"), {
          description:
            error instanceof Error ? error.message : t("common.genericError"),
        });
        return;
      }
    }

    parts.push(
      `\n---\nAfter processing all sources, if you started Builder DSI indexing, report the Builder job/design-system URL plus the local selectable design-system id returned by \`index-design-system-with-builder\`. Do not call \`create-design-system\` again for Builder-indexed Figma/code/design.md sources. If you processed non-Builder sources into concrete tokens, call \`create-design-system\` with the combined tokens${
        customInstructions.trim()
          ? " AND the verbatim --customInstructions string from above"
          : ""
      }. Present a summary for review.`,
    );

    openAgentSidebar();
    sendToDesignAgentChat({
      message: parts.join("\n"),
      submit: true,
      newTab: true,
    });
    navigate("/design-systems");
  }, [
    hasAnySources,
    companyInfo,
    websiteUrl,
    websiteUrls,
    githubUrl,
    githubLinks,
    codeFiles,
    builderIndexResult,
    docFiles,
    imageFiles,
    assets,
    selectedProjectId,
    notes,
    customInstructions,
    existingProjects,
    existingSystems,
    navigate,
    t,
    updateSystemMutation,
  ]);

  useSetPageTitle(
    <div className="flex items-center gap-2 min-w-0">
      <Link
        to="/design-systems"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground/90"
        aria-label={t("designSystemSetup.backToDesignSystems")}
      >
        <IconArrowLeft className="w-4 h-4" />
      </Link>
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {t("navigation.setupDesignSystem")}
      </h1>
    </div>,
  );

  useSetHeaderActions(
    <Button
      size="sm"
      onClick={handleContinue}
      aria-disabled={!hasAnySources}
      className="cursor-pointer aria-disabled:opacity-50"
    >
      {t("designSystemSetup.continue")}
    </Button>,
  );

  return (
    <>
      <div className="min-h-full bg-background">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {t("designSystemSetup.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("designSystemSetup.description")}
            </p>
          </div>

          {validationError && (
            <div
              role="alert"
              className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {validationError}
            </div>
          )}

          <div className="space-y-5">
            {/* Start from a Figma file via Builder DSI. */}
            <SourceAccordionRow
              icon={IconBrandFigma}
              title={t("designSystemSetup.sections.figma.title")}
              description={t("designSystemSetup.sections.figma.description")}
              expanded={sourcePanel === "figma"}
              onClick={() => setSourcePanel("figma")}
              panelId="design-system-figma-source"
            />
            <Section
              title={t("designSystemSetup.sections.figma.title")}
              description={t("designSystemSetup.sections.figma.description")}
              hidden={sourcePanel !== "figma"}
              hideHeading
              id="design-system-figma-source"
              className="rounded-lg border border-border bg-card p-4"
            >
              {!builderIndexResult ? (
                <>
                  <button
                    type="button"
                    onClick={() => realFigInputRef.current?.click()}
                    disabled={builderIndexing}
                    className="w-full rounded-xl border border-dashed border-border bg-card p-8 text-center hover:border-[#609FF8]/40 cursor-pointer disabled:cursor-wait disabled:opacity-70"
                  >
                    {builderIndexing ? (
                      <div className="flex flex-col items-center gap-2">
                        <Spinner className="size-6 text-[#609FF8]" />
                        <p className="text-sm text-foreground/80">
                          {t("designSystemSetup.figmaParsingTitle")}
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          {t("designSystemSetup.figmaParsingDescription")}
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#609FF8]/10">
                          <IconBrandFigma className="h-6 w-6 text-[#609FF8]" />
                        </div>
                        <p className="text-sm font-medium text-foreground/90">
                          {t("designSystemSetup.uploadFig")}
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          {t("designSystemSetup.figmaSaveLocalCopy")}
                        </p>
                      </div>
                    )}
                  </button>
                  <input
                    ref={realFigInputRef}
                    type="file"
                    accept=".fig"
                    onChange={handleBuilderIndexUpload}
                    className="hidden"
                  />
                  {builderIndexError && (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                    >
                      {builderIndexError}
                    </div>
                  )}
                </>
              ) : (
                <BuilderIndexPreview
                  result={builderIndexResult}
                  decodeStatus={decodeStatus}
                  displayTitle={companyInfo.trim()}
                  onReset={() => {
                    stopDecodePolling();
                    setDecodeStatus(null);
                    setBuilderIndexResult(null);
                    setBuilderIndexError(null);
                  }}
                />
              )}
            </Section>

            <SourceAccordionRow
              icon={IconPalette}
              title={t("designSystemSetup.otherSources")}
              description={t("designSystemSetup.otherSourcesDescription")}
              expanded={sourcePanel === "other"}
              onClick={() => setSourcePanel("other")}
              panelId="design-system-other-sources"
            />
            {sourcePanel === "other" && (
              <div
                id="design-system-other-sources"
                className="overflow-hidden rounded-lg border border-border"
              >
                <div className="border-b border-border px-4 py-3">
                  <p className="text-xs font-medium text-foreground/70">
                    {t("designSystemSetup.chooseSourcePrompt")}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  <SourceAccordionRow
                    className="rounded-none border-0"
                    icon={IconPalette}
                    title={t("designSystemSetup.sections.company.title")}
                    description={t(
                      "designSystemSetup.sections.company.description",
                    )}
                    expanded={otherSource === "brand"}
                    onClick={() => selectOtherSource("brand")}
                    panelId="design-system-brand-source"
                  />
                  <SourceAccordionRow
                    className="rounded-none border-0"
                    icon={IconBrandGithub}
                    title={t("designSystemSetup.sections.code.title")}
                    description={t(
                      "designSystemSetup.sections.code.description",
                    )}
                    expanded={otherSource === "code"}
                    onClick={() => selectOtherSource("code")}
                    panelId="design-system-code-source"
                  />
                  <SourceAccordionRow
                    className="rounded-none border-0"
                    icon={IconFileDescription}
                    title={t("designSystemSetup.sections.designFiles.title")}
                    description={t(
                      "designSystemSetup.sections.designFiles.description",
                    )}
                    expanded={otherSource === "files"}
                    onClick={() => selectOtherSource("files")}
                    panelId="design-system-file-source"
                  />
                  {(existingProjects.length > 0 ||
                    existingSystems.length > 0) && (
                    <SourceAccordionRow
                      className="rounded-none border-0"
                      icon={IconPalette}
                      title={t(
                        "designSystemSetup.sections.importExisting.title",
                      )}
                      description={t(
                        "designSystemSetup.sections.importExisting.description",
                      )}
                      expanded={otherSource === "existing"}
                      onClick={() => selectOtherSource("existing")}
                      panelId="design-system-existing-source"
                    />
                  )}
                  <SourceAccordionRow
                    className="rounded-none border-0"
                    icon={IconFileDescription}
                    title={t("designSystemSetup.sections.notes.title")}
                    description={t(
                      "designSystemSetup.sections.notes.description",
                    )}
                    expanded={otherSource === "notes"}
                    onClick={() => selectOtherSource("notes")}
                    panelId="design-system-notes-source"
                  />
                </div>
              </div>
            )}

            {/* Company / Brand */}
            <Section
              title={t("designSystemSetup.sections.company.title")}
              description={t("designSystemSetup.sections.company.description")}
              hidden={sourcePanel !== "other" || otherSource !== "brand"}
              hideHeading
              id="design-system-brand-source"
              className="rounded-lg border border-border bg-card p-4"
            >
              <Textarea
                value={companyInfo}
                onChange={(e) => setCompanyInfo(e.target.value)}
                placeholder={t("designSystemSetup.companyPlaceholder")}
                rows={3}
                className="bg-accent/50 border-border"
              />
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <IconWorld className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("designSystemSetup.websiteUrl")}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="bg-accent/50 border-border"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addWebsiteUrl();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addWebsiteUrl}
                    className="cursor-pointer shrink-0"
                  >
                    {t("designSystemSetup.add")}
                  </Button>
                </div>
                {websiteUrls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {websiteUrls.map((url, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5"
                      >
                        <IconCheck className="w-3.5 h-3.5 text-green-400/60 shrink-0" />
                        <span className="truncate flex-1">{url}</span>
                        <button
                          onClick={() =>
                            setWebsiteUrls((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                          className="text-muted-foreground/70 hover:text-muted-foreground shrink-0 cursor-pointer"
                        >
                          <IconX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* Code Sources */}
            <Section
              title={t("designSystemSetup.sections.code.title")}
              description={t("designSystemSetup.sections.code.description")}
              hidden={sourcePanel !== "other" || otherSource !== "code"}
              hideHeading
              id="design-system-code-source"
              className="rounded-lg border border-border bg-card p-4"
            >
              {/* GitHub */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconBrandGithub className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("designSystemSetup.githubRepository")}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                    className="bg-accent/50 border-border"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addGithubLink();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addGithubLink}
                    className="cursor-pointer shrink-0"
                  >
                    {t("designSystemSetup.add")}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  {t("designSystemSetup.privateRepoPrefix")}{" "}
                  <a
                    href="/settings#secrets:GITHUB_TOKEN"
                    className="font-medium text-foreground/80 underline-offset-2 hover:underline"
                  >
                    GITHUB_TOKEN
                  </a>{" "}
                  {t("designSystemSetup.privateRepoSuffix")}
                </p>
                {githubLinks.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {githubLinks.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5"
                      >
                        <IconCheck className="w-3.5 h-3.5 text-green-400/60 shrink-0" />
                        <span className="truncate flex-1">{link.url}</span>
                        <button
                          onClick={() => removeGithubLink(link.id)}
                          className="text-muted-foreground/70 hover:text-muted-foreground shrink-0 cursor-pointer"
                        >
                          <IconX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Local code folder */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <IconFolder className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("designSystemSetup.localCodeFiles")}
                  </span>
                </div>
                <div
                  onDrop={handleFolderDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => codeInputRef.current?.click()}
                  className="border border-dashed border-border rounded-lg p-6 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    {t("designSystemSetup.dropCodeFiles")}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {t("designSystemSetup.codeFilePatterns")}
                  </p>
                </div>
                <input
                  ref={codeInputRef}
                  type="file"
                  multiple
                  accept=".css,.scss,.sass,.less,.ts,.tsx,.js,.jsx,.json,.html,.svg,.xml,.md,.markdown,.mdx,.txt"
                  onChange={handleCodeUpload}
                  className="hidden"
                />
                {codeFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {codeFiles.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5"
                      >
                        <IconCheck className="w-3.5 h-3.5 text-green-400/60 shrink-0" />
                        <span className="truncate flex-1">
                          {f.name}
                          {f.textContent ? (
                            <span className="text-muted-foreground/60 ml-1">
                              ({formatSize(f.textContent.length)})
                            </span>
                          ) : null}
                        </span>
                        <button
                          onClick={() =>
                            setCodeFiles((prev) =>
                              prev.filter((c) => c.id !== f.id),
                            )
                          }
                          className="text-muted-foreground/70 hover:text-muted-foreground shrink-0 cursor-pointer"
                        >
                          <IconX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* Design Files */}
            <Section
              title={t("designSystemSetup.sections.designFiles.title")}
              description={t(
                "designSystemSetup.sections.designFiles.description",
              )}
              hidden={sourcePanel !== "other" || otherSource !== "files"}
              hideHeading
              id="design-system-file-source"
              className="rounded-lg border border-border bg-card p-4"
            >
              {/* Figma .fig import lives in the "Start from a Figma file"
                  section at the top — it deeply parses the file in-process. */}

              {/* Documents */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconFileDescription className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("designSystemSetup.documents")}
                  </span>
                </div>
                <button
                  onClick={() => docInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    {t("designSystemSetup.documentsHelp")}
                  </p>
                </button>
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pptx,.ppt,.docx,.doc,.pdf,.xlsx,.xls"
                  multiple
                  onChange={handleDocUpload}
                  className="hidden"
                />
                <FileList
                  files={docFiles}
                  onRemove={(id) =>
                    setDocFiles((p) => p.filter((f) => f.id !== id))
                  }
                />
              </div>

              {/* Images / screenshots */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconPhoto className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("designSystemSetup.visualReferences")}
                  </span>
                </div>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    {t("designSystemSetup.visualReferencesHelp")}
                  </p>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <FileList
                  files={imageFiles}
                  onRemove={(id) =>
                    setImageFiles((p) => p.filter((f) => f.id !== id))
                  }
                />
              </div>

              {/* Brand assets */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <IconUpload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("designSystemSetup.assets")}
                  </span>
                </div>
                <button
                  onClick={() => assetInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    {t("designSystemSetup.assetsHelp")}
                  </p>
                </button>
                <input
                  ref={assetInputRef}
                  type="file"
                  multiple
                  onChange={handleAssetUpload}
                  className="hidden"
                />
                <FileList
                  files={assets}
                  onRemove={(id) =>
                    setAssets((p) => p.filter((f) => f.id !== id))
                  }
                />
              </div>
            </Section>

            {/* Import from existing */}
            {(existingProjects.length > 0 || existingSystems.length > 0) && (
              <Section
                title={t("designSystemSetup.sections.importExisting.title")}
                description={t(
                  "designSystemSetup.sections.importExisting.description",
                )}
                hidden={sourcePanel !== "other" || otherSource !== "existing"}
                hideHeading
                id="design-system-existing-source"
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="grid grid-cols-2 gap-2">
                  {existingSystems.map((ds) => (
                    <button
                      key={ds.id}
                      onClick={() =>
                        setSelectedProjectId((prev) =>
                          prev === ds.id ? "" : ds.id,
                        )
                      }
                      className={`text-left p-3 rounded-lg border cursor-pointer ${
                        selectedProjectId === ds.id
                          ? "border-[#609FF8]/40 bg-[#609FF8]/5"
                          : "border-border bg-muted/50 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <IconPalette className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm text-foreground/70 truncate">
                          {ds.title}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
                        {t("designSystemSetup.designSystem")}
                      </span>
                    </button>
                  ))}
                  {existingProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        setSelectedProjectId((prev) =>
                          prev === p.id ? "" : p.id,
                        )
                      }
                      className={`text-left p-3 rounded-lg border cursor-pointer ${
                        selectedProjectId === p.id
                          ? "border-[#609FF8]/40 bg-[#609FF8]/5"
                          : "border-border bg-muted/50 hover:border-border"
                      }`}
                    >
                      <span className="text-sm text-foreground/70 truncate block">
                        {p.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
                        {t("designSystemSetup.designProject")}
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Notes */}
            <Section
              title={t("designSystemSetup.sections.notes.title")}
              description={t("designSystemSetup.sections.notes.description")}
              hidden={sourcePanel !== "other" || otherSource !== "notes"}
              hideHeading
              id="design-system-notes-source"
              className="rounded-lg border border-border bg-card p-4"
            >
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("designSystemSetup.notesPlaceholder")}
                rows={3}
                className="bg-accent/50 border-border"
              />
            </Section>

            {/* Custom instructions — durable, stored on the design system */}
            <Section
              title={t("designSystemSetup.sections.customInstructions.title")}
              description={t(
                "designSystemSetup.sections.customInstructions.description",
              )}
              hidden={sourcePanel !== "other" || otherSource !== "notes"}
              hideHeading
              className="rounded-lg border border-border bg-card p-4"
            >
              <Textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder={t(
                  "designSystemSetup.customInstructionsPlaceholder",
                )}
                rows={4}
                className="bg-accent/50 border-border"
              />
            </Section>

            {/* Bottom CTA */}
            <div className="pt-4">
              <Button
                onClick={handleContinue}
                aria-disabled={!hasAnySources}
                className="w-full cursor-pointer aria-disabled:opacity-50"
                size="lg"
              >
                {t("designSystemSetup.continue")}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

function Section({
  title,
  description,
  children,
  hidden = false,
  hideHeading = false,
  id,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  hidden?: boolean;
  hideHeading?: boolean;
  id?: string;
  className?: string;
}) {
  if (hidden) return null;
  return (
    <section id={id} className={className}>
      {!hideHeading && (
        <div className="mb-3">
          <h2 className="text-sm font-medium text-foreground/70">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {description}
          </p>
        </div>
      )}
      {children}
    </section>
  );
}

function SourceAccordionRow({
  icon: Icon,
  title,
  description,
  expanded,
  onClick,
  panelId,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  expanded: boolean;
  onClick: () => void;
  panelId: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-controls={panelId}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition-[background-color,border-color] duration-150 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        expanded && "bg-accent/40",
        className,
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground/90">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <IconChevronDown
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
          expanded && "rotate-180",
        )}
      />
    </button>
  );
}

function FileList({
  files,
  onRemove,
}: {
  files: UploadedFile[];
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {files.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5"
        >
          <IconCheck className="w-3.5 h-3.5 text-green-400/60 shrink-0" />
          <span className="truncate flex-1">{f.name}</span>
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {formatSize(f.size)}
          </span>
          <button
            onClick={() => onRemove(f.id)}
            className="text-muted-foreground/70 hover:text-muted-foreground shrink-0 cursor-pointer"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function BuilderIndexPreview({
  result,
  decodeStatus,
  displayTitle,
  onReset,
}: {
  result: BuilderIndexResult;
  decodeStatus: DecodeJobStatus | null;
  displayTitle?: string;
  onReset: () => void;
}) {
  const t = useT();
  const decodeError =
    decodeStatus?.status === "error" ? decodeStatus.error : null;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#609FF8]/10">
          <IconBrandFigma className="h-5 w-5 text-[#609FF8]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {displayTitle || result.suggestedTitle}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {
              "Builder is indexing this Figma file into a reusable design system." /* i18n-ignore Builder indexing status */
            }
          </p>
        </div>
      </div>

      {decodeError ? (
        <p role="alert" className="text-xs text-destructive">
          {t("designSystemSetup.figmaDecodeFailed", { error: decodeError })}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        {result.builderUrl ? (
          <Button asChild className="cursor-pointer">
            <a
              href={withBuilderUtmTrackingParams(result.builderUrl, {
                campaign: "product",
                content: "design_system_intelligence",
              })}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternalLink className="size-4" />
              {"Open in Builder" /* i18n-ignore Builder link action */}
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onReset} className="cursor-pointer">
          {t("designSystemSetup.chooseDifferentFile")}
        </Button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isDesignMdFile(file: UploadedFile): boolean {
  const name = file.name.split(/[\\/]/).pop()?.toLowerCase() ?? file.name;
  return name === "design.md" || name === "design.mdx";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isGithubRepoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const [, owner, repo] = url.pathname.split("/");
    return (
      url.hostname === "github.com" &&
      Boolean(owner) &&
      Boolean(repo) &&
      !repo.endsWith(".")
    );
  } catch {
    return false;
  }
}
