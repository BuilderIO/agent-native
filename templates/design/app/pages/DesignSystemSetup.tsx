import {
  sendToAgentChat,
  openAgentSidebar,
  useActionQuery,
  useActionMutation,
  appApiPath,
  useT,
} from "@agent-native/core/client";
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
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

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

interface FigImportResult {
  ok: boolean;
  suggestedTitle: string;
  data: {
    colors?: Record<string, string>;
    typography?: {
      headingFont?: string;
      bodyFont?: string;
      headingWeight?: string;
      bodyWeight?: string;
      headingSizes?: { h1?: string; h2?: string; h3?: string };
    };
    spacing?: Record<string, string>;
    borders?: Record<string, string>;
    defaults?: Record<string, string>;
    customCSS?: string;
    notes?: string;
  };
  customInstructions: string;
  preview: {
    gradients: string[];
    palette: { hex: string; name?: string; count: number }[];
    namedColors: Record<string, string>;
    thumbnailDataUrl: string | null;
    nodeCount: number;
    imageCount: number;
  };
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
  const [figFiles] = useState<UploadedFile[]>([]);
  const [docFiles, setDocFiles] = useState<UploadedFile[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadedFile[]>([]);
  const [assets, setAssets] = useState<UploadedFile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

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

  const existingProjects = designsData?.designs ?? [];
  const existingSystems = designSystemsData?.designSystems ?? [];

  // --- Figma .fig import (deep brand extraction → design system) ----------
  const queryClient = useQueryClient();
  const createSystemMutation = useActionMutation("create-design-system");
  const realFigInputRef = useRef<HTMLInputElement>(null);
  const [figParsing, setFigParsing] = useState(false);
  const [figResult, setFigResult] = useState<FigImportResult | null>(null);
  const [figError, setFigError] = useState<string | null>(null);
  const [figTitle, setFigTitle] = useState("");
  const [figCreating, setFigCreating] = useState(false);

  const handleFigImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".fig")) {
        setFigError(t("designSystemSetup.errors.chooseFig"));
        return;
      }
      setFigError(null);
      setFigResult(null);
      setFigParsing(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(appApiPath("/api/import-figma-system"), {
          method: "POST",
          body,
        });
        const json = await res.json();
        if (!res.ok || json?.error) {
          throw new Error(json?.error || `Upload failed (${res.status})`);
        }
        setFigResult(json as FigImportResult);
        setFigTitle(
          (json as FigImportResult).suggestedTitle ||
            t("designSystemSetup.importedBrand"),
        );
      } catch (err) {
        setFigError(
          err instanceof Error
            ? err.message
            : t("designSystemSetup.errors.parseFig"),
        );
      } finally {
        setFigParsing(false);
      }
    },
    [t],
  );

  const handleCreateFromFig = useCallback(async () => {
    if (!figResult) return;
    const title =
      figTitle.trim() ||
      figResult.suggestedTitle ||
      t("designSystemSetup.importedBrand");
    setFigCreating(true);
    try {
      const created = (await createSystemMutation.mutateAsync({
        title,
        data: JSON.stringify(figResult.data),
        customInstructions: figResult.customInstructions || "",
      } as any)) as { id?: string } | undefined;
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-design-systems"],
      });
      toast.success(t("designSystemSetup.figmaCreateSuccess"));
      navigate(
        created?.id
          ? `/design-systems?designSystemId=${encodeURIComponent(created.id)}`
          : "/design-systems",
      );
    } catch (err) {
      setFigCreating(false);
      toast.error(t("designSystemSetup.figmaCreateError"), {
        description:
          err instanceof Error ? err.message : t("common.genericError"),
      });
    }
  }, [figResult, figTitle, createSystemMutation, queryClient, navigate, t]);

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
      figFiles.length > 0 ||
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
    figFiles,
    docFiles,
    imageFiles,
    assets,
    selectedProjectId,
    notes,
    customInstructions,
  ]);

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
            /\.(css|scss|sass|less|ts|tsx|js|jsx|json|html|svg|xml)$/i,
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

  const handleContinue = useCallback(() => {
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

    const parts: string[] = [];
    parts.push(
      "Set up a design system from the following sources. Analyze each source, extract design tokens (colors, fonts, spacing, borders), and create a cohesive design system.",
    );

    if (companyInfo.trim()) {
      parts.push(`\n## Company / Brand\n${companyInfo.trim()}`);
    }

    if (normalizedWebsiteUrls.length > 0) {
      parts.push(
        `\n## Website URLs\nExtract design tokens from these websites:\n${normalizedWebsiteUrls.map((u) => `- ${u}`).join("\n")}\n\n**Best approach:** Call \`activate-browser\` first, then use chrome-devtools MCP tools to navigate each URL and extract computed styles (colors, fonts, spacing, CSS custom properties) via \`evaluate_script\`. This captures the real rendered design — including JS-injected styles, CSS-in-JS, and SPA content that plain HTML fetch misses. Take a screenshot too for visual reference. If Builder is not connected, fall back to \`import-from-url\` for each URL (limited to static HTML parsing).`,
      );
    }

    if (normalizedGithubLinks.length > 0) {
      parts.push(
        `\n## GitHub Repositories\nExtract design tokens from code. Call \`import-github\` for each:\n${normalizedGithubLinks.map((l) => `- ${l.url}`).join("\n")}\n\nIf a repository is private or GitHub denies access, tell me to save a fine-grained GitHub token as \`GITHUB_TOKEN\` in Settings > Secrets. The token should be limited to the repository with Repository permissions > Contents: Read-only. Do not ask me to paste a PAT into chat.`,
      );
    }

    if (codeFiles.length > 0) {
      const withContent = codeFiles.filter((f) => f.textContent);
      const withoutContent = codeFiles.filter((f) => !f.textContent);

      if (withContent.length > 0) {
        parts.push(
          `\n## Code Files (${withContent.length} files with content)\nCall \`import-code\` with these files:`,
        );
        for (const f of withContent) {
          parts.push(
            `\n### ${f.name}\n\`\`\`\n${f.textContent!.slice(0, 5000)}\n\`\`\``,
          );
        }
      }
      if (withoutContent.length > 0) {
        parts.push(
          `\nBinary code files (could not read):\n${withoutContent.map((f) => `- ${f.name}`).join("\n")}`,
        );
      }
    }

    if (figFiles.length > 0) {
      parts.push(
        `\n## Figma Files\nCall \`import-figma\` and describe the design system from:\n${figFiles.map((f) => `- ${f.name}`).join("\n")}`,
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
        `\n## Custom Instructions (durable — store on the design system)\nWhen you call \`create-design-system\`, pass these verbatim as the \`customInstructions\` argument. They will be re-applied every time the design system is used to generate a design:\n\n${customInstructions.trim()}`,
      );
    }

    parts.push(
      `\n---\nAfter processing all sources, call \`create-design-system\` with the combined tokens${
        customInstructions.trim()
          ? " AND the verbatim --customInstructions string from above"
          : ""
      }. Present a summary for review.`,
    );

    openAgentSidebar();
    sendToAgentChat({ message: parts.join("\n"), submit: true, newTab: true });
    navigate("/design-systems");
  }, [
    hasAnySources,
    companyInfo,
    websiteUrl,
    websiteUrls,
    githubUrl,
    githubLinks,
    codeFiles,
    figFiles,
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
  ]);

  useSetPageTitle(
    <div className="flex items-center gap-2 min-w-0">
      <button
        onClick={() => navigate("/design-systems")}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground/90"
        aria-label={t("designSystemSetup.backToDesignSystems")}
      >
        <IconArrowLeft className="w-4 h-4" />
      </button>
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

          <div className="space-y-8">
            {/* Start from a Figma file — deep brand extraction → ready system */}
            <Section
              title={t("designSystemSetup.sections.figma.title")}
              description={t("designSystemSetup.sections.figma.description")}
            >
              {!figResult ? (
                <>
                  <button
                    type="button"
                    onClick={() => realFigInputRef.current?.click()}
                    disabled={figParsing}
                    className="w-full rounded-xl border border-dashed border-border bg-card p-8 text-center hover:border-[#609FF8]/40 cursor-pointer disabled:cursor-wait disabled:opacity-70"
                  >
                    {figParsing ? (
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
                    onChange={handleFigImport}
                    className="hidden"
                  />
                  {figError && (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                    >
                      {figError}
                    </div>
                  )}
                </>
              ) : (
                <FigImportPreview
                  result={figResult}
                  title={figTitle}
                  onTitleChange={setFigTitle}
                  creating={figCreating}
                  onCreate={handleCreateFromFig}
                  onReset={() => {
                    setFigResult(null);
                    setFigError(null);
                  }}
                />
              )}
            </Section>

            {/* Company / Brand */}
            <Section
              title={t("designSystemSetup.sections.company.title")}
              description={t("designSystemSetup.sections.company.description")}
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
                  accept=".css,.scss,.sass,.less,.ts,.tsx,.js,.jsx,.json,.html,.svg"
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
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground/70">{title}</h2>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{description}</p>
      </div>
      {children}
    </section>
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

function FigImportPreview({
  result,
  title,
  onTitleChange,
  creating,
  onCreate,
  onReset,
}: {
  result: FigImportResult;
  title: string;
  onTitleChange: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
  onReset: () => void;
}) {
  const t = useT();
  const colors = result.data.colors ?? {};
  const colorEntries = (
    [
      [t("designSystemSetup.colorLabels.accent"), "accent"],
      [t("designSystemSetup.colorLabels.primary"), "primary"],
      [t("designSystemSetup.colorLabels.secondary"), "secondary"],
      [t("designSystemSetup.colorLabels.background"), "background"],
      [t("designSystemSetup.colorLabels.surface"), "surface"],
      [t("designSystemSetup.colorLabels.text"), "text"],
      [t("designSystemSetup.colorLabels.muted"), "textMuted"],
    ] as const
  ).filter(([, k]) => colors[k]);
  const typo = result.data.typography ?? {};
  const gradients = result.preview.gradients ?? [];

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-4">
        {result.preview.thumbnailDataUrl ? (
          <img
            src={result.preview.thumbnailDataUrl}
            alt={t("designSystemSetup.figmaThumbnailAlt")}
            className="h-20 w-28 shrink-0 rounded-md border border-border object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("designSystemSetup.designSystemName")}
          </label>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="mt-1 bg-accent/50"
            placeholder={t("designSystemSetup.brandNamePlaceholder")}
          />
          <p className="mt-2 text-xs text-muted-foreground/70">
            {t("designSystemSetup.extractedSummary", {
              nodes: result.preview.nodeCount.toLocaleString(),
              gradients: gradients.length,
              images: result.preview.imageCount,
            })}
          </p>
        </div>
      </div>

      {colorEntries.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t("designSystemSetup.previewColors")}
          </h4>
          <div className="flex flex-wrap gap-3">
            {colorEntries.map(([label, k]) => (
              <div key={k} className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-md border border-border"
                  style={{ backgroundColor: colors[k] }}
                />
                <div className="text-xs">
                  <div className="text-foreground/80">{label}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {colors[k]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {gradients.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t("designSystemSetup.signatureGradients")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {gradients.slice(0, 4).map((g, i) => (
              <div
                key={i}
                className="h-10 w-28 rounded-md border border-border"
                style={{ backgroundImage: g }}
                title={g}
              />
            ))}
          </div>
        </div>
      )}

      {(typo.headingFont || typo.bodyFont) && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t("designSystemSetup.previewTypography")}
          </h4>
          <div className="text-sm text-foreground/80">
            {typo.headingFont && (
              <span>
                <span className="text-muted-foreground">
                  {t("designSystemSetup.headingsLabel")}
                </span>{" "}
                {typo.headingFont}
                {typo.headingWeight ? ` ${typo.headingWeight}` : ""}
              </span>
            )}
            {typo.bodyFont && (
              <span className="ml-4">
                <span className="text-muted-foreground">
                  {t("designSystemSetup.bodyLabel")}
                </span>{" "}
                {typo.bodyFont}
              </span>
            )}
          </div>
        </div>
      )}

      {result.customInstructions && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t("designSystemSetup.brandBrief")}
          </h4>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            {result.customInstructions}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            {t("designSystemSetup.brandBriefHelp")}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button
          onClick={onCreate}
          disabled={creating || !title.trim()}
          className="cursor-pointer"
        >
          {creating ? (
            <>
              <Spinner className="size-4" /> {t("designSystemSetup.creating")}
            </>
          ) : (
            t("designSystemSetup.createDesignSystem")
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={onReset}
          disabled={creating}
          className="cursor-pointer"
        >
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
