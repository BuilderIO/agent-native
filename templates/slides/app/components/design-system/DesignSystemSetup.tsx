import {
  useActionQuery,
  useActionMutation,
  sendToAgentChat,
  openAgentSidebar,
  appApiPath,
  useT,
} from "@agent-native/core/client";
import { toast } from "@agent-native/toolkit/hooks/use-toast";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { ScrollArea } from "@agent-native/toolkit/ui/scroll-area";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconWorld,
  IconPalette,
  IconLoader2,
  IconBrandGithub,
  IconBrandFigma,
  IconFolder,
  IconX,
  IconFileDescription,
  IconPhoto,
  IconCheck,
  IconExternalLink,
} from "@tabler/icons-react";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";

import {
  MAX_BUILDER_INDEX_UPLOAD_BYTES,
  readBuilderIndexResponse,
  formatFileSize,
  type BuilderIndexResult,
} from "./builder-index-response";

interface DesignSystemSetupProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  editingId?: string;
}

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

function normalizeWebsiteUrlInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : /^[a-z\d-]+$/i.test(trimmed)
      ? `https://${trimmed}.com`
      : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname || /\s/.test(parsed.hostname)) return null;
    const normalized = parsed.toString();
    return normalized.endsWith("/") && !parsed.pathname.slice(1)
      ? normalized.slice(0, -1)
      : normalized;
  } catch {
    return null;
  }
}

function isDesignMdFile(file: UploadedFile) {
  const name = file.name.split(/[\\/]/).pop()?.toLowerCase() ?? file.name;
  return name === "design.md" || name === "design.mdx";
}

export function DesignSystemSetup({
  open,
  onClose,
  onComplete,
  editingId,
}: DesignSystemSetupProps) {
  const t = useT();
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLinks, setGithubLinks] = useState<GitHubLink[]>([]);
  const [codeFiles, setCodeFiles] = useState<UploadedFile[]>([]);
  const [docFiles, setDocFiles] = useState<UploadedFile[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadedFile[]>([]);
  const [brandNotes, setBrandNotes] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [builderIndexing, setBuilderIndexing] = useState(false);
  const [builderIndexResult, setBuilderIndexResult] =
    useState<BuilderIndexResult | null>(null);
  const [builderIndexError, setBuilderIndexError] = useState<string | null>(
    null,
  );

  const codeInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const figInputRef = useRef<HTMLInputElement>(null);
  const updateSystemMutation = useActionMutation("update-design-system");

  const { data: existingDs } = useActionQuery<{
    title?: string;
    description?: string;
    data?: string | null;
    customInstructions?: string;
  }>("get-design-system", editingId ? { id: editingId } : undefined, {
    enabled: !!editingId && open,
  });

  const { data: designSystemsData } = useActionQuery<{
    designSystems: Array<{ id: string; title: string }>;
  }>("list-design-systems");

  const existingSystems = designSystemsData?.designSystems ?? [];
  const [selectedSystemId, setSelectedSystemId] = useState("");

  useEffect(() => {
    if (existingDs && editingId) {
      setCompanyName(existingDs.title ?? "");
      setBrandNotes(existingDs.description ?? "");
      setCustomInstructions(existingDs.customInstructions ?? "");
      try {
        const parsed = existingDs.data ? JSON.parse(existingDs.data) : null;
        if (parsed?.notes) setBrandNotes(parsed.notes);
      } catch {
        // ignore
      }
    }
  }, [existingDs, editingId]);

  useEffect(() => {
    if (!open) {
      setCompanyName("");
      setWebsiteUrl("");
      setWebsiteUrls([]);
      setGithubUrl("");
      setGithubLinks([]);
      setCodeFiles([]);
      setDocFiles([]);
      setImageFiles([]);
      setBrandNotes("");
      setCustomInstructions("");
      setSelectedSystemId("");
      setBuilderIndexing(false);
      setBuilderIndexResult(null);
      setBuilderIndexError(null);
    }
  }, [open]);

  const hasAnySources = useMemo(() => {
    return (
      companyName.trim() ||
      websiteUrls.length > 0 ||
      githubLinks.length > 0 ||
      codeFiles.length > 0 ||
      builderIndexResult ||
      docFiles.length > 0 ||
      imageFiles.length > 0 ||
      selectedSystemId ||
      brandNotes.trim() ||
      customInstructions.trim()
    );
  }, [
    companyName,
    websiteUrls,
    githubLinks,
    codeFiles,
    builderIndexResult,
    docFiles,
    imageFiles,
    selectedSystemId,
    brandNotes,
    customInstructions,
  ]);

  const addWebsiteUrl = useCallback(() => {
    const url = normalizeWebsiteUrlInput(websiteUrl);
    if (!url) return;
    setWebsiteUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setWebsiteUrl("");
  }, [websiteUrl]);

  const addGithubLink = useCallback(() => {
    const url = githubUrl.trim();
    if (!url) return;
    setGithubLinks((prev) => [...prev, { id: crypto.randomUUID(), url }]);
    setGithubUrl("");
  }, [githubUrl]);

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
    [t],
  );

  const handleBuilderIndexUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".fig")) {
        setBuilderIndexError(t("designSystemSetup.figFileRequired"));
        return;
      }
      if (file.size > MAX_BUILDER_INDEX_UPLOAD_BYTES) {
        setBuilderIndexError(
          t("designSystemSetup.figFileTooLarge", {
            maxSize: formatFileSize(MAX_BUILDER_INDEX_UPLOAD_BYTES),
          }),
        );
        return;
      }

      setBuilderIndexError(null);
      setBuilderIndexResult(null);
      setBuilderIndexing(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(
          appApiPath("/api/index-design-system-with-builder"),
          {
            method: "POST",
            body,
          },
        );
        const parsed = await readBuilderIndexResponse(res);
        setBuilderIndexResult(parsed);
      } catch (err) {
        setBuilderIndexError(
          err instanceof Error
            ? err.message
            : t("designSystemSetup.figParseFailed"),
        );
      } finally {
        setBuilderIndexing(false);
      }
    },
    [t],
  );

  const handleEditSave = async () => {
    if (!editingId) return;
    setGenerating(true);
    try {
      await updateSystemMutation.mutateAsync({
        id: editingId,
        title: companyName || "My Brand",
        description: brandNotes || undefined,
        customInstructions,
      });
      onComplete();
      toast({ title: t("designSystemSetup.updated") });
    } catch {
      toast({
        title: t("designSystemSetup.updateFailed"),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = useCallback(() => {
    if (editingId) {
      handleEditSave();
      return;
    }

    // Cap inlined file content so a giant pasted README doesn't blow the
    // prompt budget. Append a marker so the agent doesn't treat the
    // truncation point as the end of the document.
    const TEXT_INLINE_MAX = 5000;
    const inlineText = (text: string) =>
      text.length > TEXT_INLINE_MAX
        ? `${text.slice(0, TEXT_INLINE_MAX)}\n…[truncated, ${text.length - TEXT_INLINE_MAX} more chars]`
        : text;

    const parts: string[] = [];
    parts.push(
      "Set up a design system from the following sources. Use Builder Design System Intelligence (DSI) as the source of truth for reusable Figma/code/design.md indexing. Analyze each source, extract design tokens (colors, fonts, spacing, borders), and create a cohesive design system for my slide decks.",
    );

    if (companyName.trim()) {
      parts.push(`\n## Company / Brand\n${companyName.trim()}`);
    }

    if (websiteUrls.length > 0) {
      parts.push(
        `\n## Website URLs\nAnalyze these websites for design tokens. Call \`import-from-url\` for each:\n${websiteUrls.map((u) => `- ${u}`).join("\n")}`,
      );
    }

    if (githubLinks.length > 0) {
      parts.push(
        `\n## Connect Code: GitHub Repositories\nStart Builder DSI indexing for each repository with \`index-design-system-with-builder\`:\n${githubLinks.map((l) => `- ${l.url}`).join("\n")}\n\nBuilder is the source of truth for repo/code design-system indexing. The action also creates a local selectable proxy design system for Slides flows. If Builder is not connected, stop and tell me to connect Builder from Settings.`,
      );
    }

    const designMdFiles = [...codeFiles, ...docFiles].filter(
      (file) => file.textContent && isDesignMdFile(file),
    );

    if (codeFiles.length > 0) {
      const withContent = codeFiles.filter(
        (f) => f.textContent && !isDesignMdFile(f),
      );
      if (withContent.length > 0) {
        parts.push(
          `\n## Connect Code: Code Files (${withContent.length} files)\nStart Builder DSI indexing with \`index-design-system-with-builder\` using these files as the \`codeFiles\` argument:`,
        );
        for (const f of withContent) {
          parts.push(
            `\n### ${f.name}\n\`\`\`\n${inlineText(f.textContent!)}\n\`\`\``,
          );
        }
      }
    }

    if (designMdFiles.length > 0) {
      parts.push(
        `\n## Optional design.md (${designMdFiles.length} file${designMdFiles.length === 1 ? "" : "s"})\nPass this content as the \`designMd\` argument to \`index-design-system-with-builder\` alongside any Figma/code sources:`,
      );
      for (const f of designMdFiles) {
        parts.push(
          `\n### ${f.name}\n\`\`\`md\n${inlineText(f.textContent!)}\n\`\`\``,
        );
      }
    }

    if (builderIndexResult) {
      parts.push(
        `\n## Connect Figma: Builder-Indexed Figma File\nBuilder DSI indexing has already started.\n- Design system: ${builderIndexResult.designSystemId}\n- Local selectable design system: ${builderIndexResult.localDesignSystemId ?? "(not returned)"}\n- Project: ${builderIndexResult.projectId}\n- Job: ${builderIndexResult.jobId}\n- URL: ${builderIndexResult.builderUrl}\n\nUse Builder as the source of truth for extracted tokens, assets, components, and guidance. Do not call \`create-design-system\` again for this Builder-indexed source.`,
      );
    }

    if (docFiles.length > 0) {
      const inlined = docFiles.filter(
        (f) => f.textContent && !isDesignMdFile(f),
      );
      const binary = docFiles.filter((f) => !f.textContent);
      if (inlined.length > 0) {
        parts.push(
          `\n## Documents (${inlined.length} text files — content inlined)\nExtract brand cues from the content below.`,
        );
        for (const f of inlined) {
          parts.push(
            `\n### ${f.name}\n\`\`\`\n${inlineText(f.textContent!)}\n\`\`\``,
          );
        }
      }
      if (binary.length > 0) {
        parts.push(
          `\n## Documents\nExtract brand cues. Call \`import-document\` with metadata:\n${binary.map((f) => `- ${f.name} (${f.type}, ${formatSize(f.size)})`).join("\n")}`,
        );
      }
    }

    if (imageFiles.length > 0) {
      parts.push(
        `\n## Visual References\n${imageFiles.map((f) => `- ${f.name}`).join("\n")}`,
      );
    }

    if (selectedSystemId) {
      const system = existingSystems.find((s) => s.id === selectedSystemId);
      if (system) {
        parts.push(
          `\n## Fork Existing Design System\nClone "${system.title}" as a starting point. Call \`import-design-project --designSystemId ${selectedSystemId}\``,
        );
      }
    }

    if (brandNotes.trim()) {
      parts.push(`\n## Additional Notes\n${brandNotes.trim()}`);
    }

    if (customInstructions.trim()) {
      parts.push(
        `\n## Custom Instructions (durable — store on the design system)\nIf you create a local design system from non-Builder sources, pass these verbatim as the \`customInstructions\` argument. They will be re-applied every time the design system is used to generate slides:\n\n${customInstructions.trim()}`,
      );
    }

    parts.push(
      `\n---\nAfter processing all sources, if you started Builder DSI indexing, report the Builder job/design-system URL plus the local selectable design-system id returned by \`index-design-system-with-builder\`. Do not call \`create-design-system\` again for Builder-indexed Figma/code/design.md sources. If you processed non-Builder sources into concrete tokens, call \`create-design-system\` with the combined tokens${
        customInstructions.trim()
          ? " AND the verbatim --customInstructions string from above"
          : ""
      }. Present a summary for review.`,
    );

    openAgentSidebar();
    sendToAgentChat({ message: parts.join("\n"), submit: true });
    toast({
      title: t("designSystemSetup.generationStarted"),
      description: t("designSystemSetup.generationStartedDescription"),
    });
    onComplete();
  }, [
    editingId,
    companyName,
    websiteUrls,
    githubLinks,
    codeFiles,
    builderIndexResult,
    docFiles,
    imageFiles,
    selectedSystemId,
    existingSystems,
    brandNotes,
    customInstructions,
    onComplete,
    t,
  ]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] p-0 bg-card border-border">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-foreground flex items-center gap-2">
            <IconPalette className="w-5 h-5 text-[#609FF8]" />
            {editingId
              ? t("designSystemSetup.editTitle")
              : t("designSystemSetup.newTitle")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {editingId
              ? t("designSystemSetup.editDescription")
              : t("designSystemSetup.newDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-160px)] px-6">
          <div className="space-y-5 py-4">
            {/* Company Name */}
            <div className="space-y-2">
              <Label className="text-foreground/80">
                {t("designSystemSetup.companyBrand")}
              </Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t("designSystemSetup.companyBrandPlaceholder")}
                className="bg-accent border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {!editingId && (
              <>
                {/* Figma .fig */}
                <div className="space-y-2">
                  <Label className="text-foreground/80 flex items-center gap-1.5">
                    <IconBrandFigma className="w-3.5 h-3.5" />
                    {t("designSystemSetup.figmaFile")}
                  </Label>
                  {!builderIndexResult ? (
                    <>
                      <button
                        type="button"
                        onClick={() => figInputRef.current?.click()}
                        disabled={builderIndexing}
                        className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/20 cursor-pointer disabled:cursor-wait disabled:opacity-70"
                      >
                        {builderIndexing ? (
                          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                            {t("designSystemSetup.parsingFigmaFile")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("designSystemSetup.uploadFigDescription")}
                          </span>
                        )}
                      </button>
                      <input
                        ref={figInputRef}
                        type="file"
                        accept=".fig"
                        onChange={handleBuilderIndexUpload}
                        className="hidden"
                      />
                      {builderIndexError && (
                        <div
                          role="alert"
                          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                        >
                          {builderIndexError}
                        </div>
                      )}
                    </>
                  ) : (
                    <BuilderIndexPreview
                      result={builderIndexResult}
                      onReset={() => {
                        setBuilderIndexResult(null);
                        setBuilderIndexError(null);
                      }}
                    />
                  )}
                </div>

                {/* Website URL */}
                <div className="space-y-2">
                  <Label className="text-foreground/80 flex items-center gap-1.5">
                    <IconWorld className="w-3.5 h-3.5" />
                    {t("designSystemSetup.websiteUrl")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder={t("designSystemSetup.websitePlaceholder")}
                      className="bg-accent border-border text-foreground placeholder:text-muted-foreground"
                      onBlur={() => {
                        const normalized = normalizeWebsiteUrlInput(websiteUrl);
                        if (normalized) setWebsiteUrl(normalized);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addWebsiteUrl();
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addWebsiteUrl}
                      className="shrink-0 cursor-pointer"
                    >
                      {t("designSystemSetup.add")}
                    </Button>
                  </div>
                  <TagList
                    items={websiteUrls}
                    onRemove={(i) =>
                      setWebsiteUrls((p) => p.filter((_, j) => j !== i))
                    }
                  />
                </div>

                {/* GitHub */}
                <div className="space-y-2">
                  <Label className="text-foreground/80 flex items-center gap-1.5">
                    <IconBrandGithub className="w-3.5 h-3.5" />
                    {t("designSystemSetup.githubRepository")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/org/repo"
                      className="bg-accent border-border text-foreground placeholder:text-muted-foreground"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addGithubLink();
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addGithubLink}
                      className="shrink-0 cursor-pointer"
                    >
                      {t("designSystemSetup.add")}
                    </Button>
                  </div>
                  <TagList
                    items={githubLinks.map((l) => l.url)}
                    onRemove={(i) =>
                      setGithubLinks((p) => p.filter((_, j) => j !== i))
                    }
                  />
                </div>

                {/* Code Files */}
                <div className="space-y-2">
                  <Label className="text-foreground/80 flex items-center gap-1.5">
                    <IconFolder className="w-3.5 h-3.5" />
                    {t("designSystemSetup.codeFiles")}
                  </Label>
                  <button
                    onClick={() => codeInputRef.current?.click()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files)
                        readTextFiles(e.dataTransfer.files, setCodeFiles);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/20 cursor-pointer"
                  >
                    <p className="text-xs text-muted-foreground">
                      {t("designSystemSetup.codeFilesDrop")}
                    </p>
                  </button>
                  <input
                    ref={codeInputRef}
                    type="file"
                    multiple
                    accept=".css,.scss,.sass,.less,.ts,.tsx,.js,.jsx,.json,.html,.svg,.xml,.md,.markdown,.mdx,.txt"
                    onChange={(e) => {
                      if (e.target.files)
                        readTextFiles(e.target.files, setCodeFiles);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  <FileList
                    files={codeFiles}
                    onRemove={(id) =>
                      setCodeFiles((p) => p.filter((f) => f.id !== id))
                    }
                  />
                </div>

                {/* Documents */}
                <div className="space-y-2">
                  <Label className="text-foreground/80 flex items-center gap-1.5">
                    <IconFileDescription className="w-3.5 h-3.5" />
                    {t("designSystemSetup.documents")}
                  </Label>
                  <button
                    onClick={() => docInputRef.current?.click()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files)
                        readTextFiles(e.dataTransfer.files, setDocFiles);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/20 cursor-pointer"
                  >
                    <p className="text-xs text-muted-foreground">
                      {t("designSystemSetup.documentsDrop")}
                    </p>
                  </button>
                  <input
                    ref={docInputRef}
                    type="file"
                    accept=".pptx,.ppt,.docx,.doc,.pdf,.xlsx,.xls,.md,.markdown,.mdx,.txt"
                    multiple
                    onChange={(e) => {
                      if (e.target.files)
                        readTextFiles(e.target.files, setDocFiles);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  <FileList
                    files={docFiles}
                    onRemove={(id) =>
                      setDocFiles((p) => p.filter((f) => f.id !== id))
                    }
                  />
                </div>

                {/* Images */}
                <div className="space-y-2">
                  <Label className="text-foreground/80 flex items-center gap-1.5">
                    <IconPhoto className="w-3.5 h-3.5" />
                    {t("designSystemSetup.visualReferences")}
                  </Label>
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/20 cursor-pointer"
                  >
                    <p className="text-xs text-muted-foreground">
                      {t("designSystemSetup.visualReferencesDrop")}
                    </p>
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*,.svg"
                    multiple
                    onChange={(e) => {
                      if (!e.target.files) return;
                      const newFiles = Array.from(e.target.files).map((f) => ({
                        id: crypto.randomUUID(),
                        name: f.name,
                        type: f.type,
                        size: f.size,
                      }));
                      setImageFiles((p) => [...p, ...newFiles]);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  <FileList
                    files={imageFiles}
                    onRemove={(id) =>
                      setImageFiles((p) => p.filter((f) => f.id !== id))
                    }
                  />
                </div>

                {/* Fork existing */}
                {existingSystems.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-foreground/80">
                      {t("designSystemSetup.forkExisting")}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {existingSystems
                        .filter((s) => s.id !== editingId)
                        .map((ds) => (
                          <button
                            key={ds.id}
                            onClick={() =>
                              setSelectedSystemId((prev) =>
                                prev === ds.id ? "" : ds.id,
                              )
                            }
                            className={`text-left p-3 rounded-lg border cursor-pointer ${
                              selectedSystemId === ds.id
                                ? "border-[#609FF8]/40 bg-[#609FF8]/5"
                                : "border-border bg-accent hover:border-foreground/20"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <IconPalette className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-sm text-foreground/80 truncate">
                                {ds.title}
                              </span>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Brand Notes */}
            <div className="space-y-2">
              <Label className="text-foreground/80">
                {editingId
                  ? t("designSystemSetup.brandNotes")
                  : t("designSystemSetup.additionalNotes")}
              </Label>
              <Textarea
                value={brandNotes}
                onChange={(e) => setBrandNotes(e.target.value)}
                placeholder={t("designSystemSetup.notesPlaceholder")}
                rows={3}
                className="bg-accent border-border text-foreground placeholder:text-muted-foreground resize-none"
              />
            </div>

            {/* Custom Instructions — durable, stored on the design system */}
            <div className="space-y-2">
              <Label className="text-foreground/80">
                {t("designSystemSetup.customInstructions")}
              </Label>
              <Textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder={t(
                  "designSystemSetup.customInstructionsPlaceholder",
                )}
                rows={4}
                className="bg-accent border-border text-foreground placeholder:text-muted-foreground resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("designSystemSetup.customInstructionsDescription")}
              </p>
            </div>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 pb-6 pt-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={generating}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {t("designSystemSetup.cancel")}
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={editingId ? generating : !hasAnySources}
            className="cursor-pointer"
          >
            {generating ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                {t("designSystemSetup.saving")}
              </>
            ) : editingId ? (
              t("designSystemSetup.saveChanges")
            ) : (
              t("designSystemSetup.continueToGeneration")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TagList({
  items,
  onRemove,
}: {
  items: string[];
  onRemove: (index: number) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2 text-sm text-foreground/80 bg-accent rounded-md px-3 py-1.5"
        >
          <IconCheck className="w-3.5 h-3.5 text-green-500/70 shrink-0" />
          <span className="truncate flex-1">{item}</span>
          <button
            onClick={() => onRemove(i)}
            aria-label={t("designSystemSetup.removeItem", { item })}
            className="text-muted-foreground hover:text-foreground/70 shrink-0 cursor-pointer"
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
  onReset,
}: {
  result: BuilderIndexResult;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4 rounded-lg border border-border bg-accent/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#609FF8]/10">
          <IconBrandFigma className="h-5 w-5 text-[#609FF8]" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h4 className="text-sm font-medium text-foreground">
            {t("designSystemSetup.builderIndexingStarted")}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t("designSystemSetup.builderIndexingDescription", {
              title:
                result.suggestedTitle || t("designSystemSetup.importedBrand"),
            })}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border border-border bg-card/50 p-3 text-xs">
        <dt className="text-muted-foreground">
          {t("designSystemSetup.builderDesignSystemId")}
        </dt>
        <dd className="truncate font-mono text-foreground/80">
          {result.designSystemId}
        </dd>
        <dt className="text-muted-foreground">
          {t("designSystemSetup.builderJobId")}
        </dt>
        <dd className="truncate font-mono text-foreground/80">
          {result.jobId}
        </dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" asChild className="cursor-pointer">
          <a href={result.builderUrl} target="_blank" rel="noreferrer">
            <IconExternalLink className="w-3.5 h-3.5" />
            {t("designSystemSetup.openInBuilder")}
          </a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          className="cursor-pointer"
        >
          {t("designSystemSetup.chooseAnotherFile")}
        </Button>
      </div>
    </div>
  );
}

function FileList({
  files,
  onRemove,
}: {
  files: UploadedFile[];
  onRemove: (id: string) => void;
}) {
  const t = useT();
  if (files.length === 0) return null;
  return (
    <div className="space-y-1">
      {files.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-2 text-sm text-foreground/80 bg-accent rounded-md px-3 py-1.5"
        >
          <IconCheck className="w-3.5 h-3.5 text-green-500/70 shrink-0" />
          <span className="truncate flex-1">{f.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatSize(f.size)}
          </span>
          <button
            onClick={() => onRemove(f.id)}
            aria-label={t("designSystemSetup.removeItem", { item: f.name })}
            className="text-muted-foreground hover:text-foreground/70 shrink-0 cursor-pointer"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
