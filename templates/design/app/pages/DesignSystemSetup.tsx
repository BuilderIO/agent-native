import { useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  IconArrowLeft,
  IconBrandGithub,
  IconUpload,
  IconFolder,
  IconX,
  IconWorld,
  IconFileDescription,
  IconPhoto,
  IconPalette,
  IconCheck,
} from "@tabler/icons-react";
import {
  AgentSidebar,
  sendToAgentChat,
  openAgentSidebar,
  useActionQuery,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function DesignSystemSetup() {
  const navigate = useNavigate();

  const [companyInfo, setCompanyInfo] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLinks, setGithubLinks] = useState<GitHubLink[]>([]);
  const [codeFiles, setCodeFiles] = useState<UploadedFile[]>([]);
  const [figFiles, setFigFiles] = useState<UploadedFile[]>([]);
  const [docFiles, setDocFiles] = useState<UploadedFile[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadedFile[]>([]);
  const [assets, setAssets] = useState<UploadedFile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const figInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const { data: designsData } = useActionQuery<{
    designs: Array<{ id: string; title: string; designSystemId?: string }>;
  }>("list-designs");

  const { data: designSystemsData } = useActionQuery<{
    designSystems: Array<{ id: string; title: string }>;
  }>("list-design-systems");

  const existingProjects = designsData?.designs ?? [];
  const existingSystems = designSystemsData?.designSystems ?? [];

  const hasAnySources = useMemo(() => {
    return (
      companyInfo.trim() ||
      websiteUrls.length > 0 ||
      githubLinks.length > 0 ||
      codeFiles.length > 0 ||
      figFiles.length > 0 ||
      docFiles.length > 0 ||
      imageFiles.length > 0 ||
      assets.length > 0 ||
      selectedProjectId ||
      notes.trim()
    );
  }, [
    companyInfo,
    websiteUrls,
    githubLinks,
    codeFiles,
    figFiles,
    docFiles,
    imageFiles,
    assets,
    selectedProjectId,
    notes,
  ]);

  const addWebsiteUrl = useCallback(() => {
    const url = websiteUrl.trim();
    if (!url) return;
    setWebsiteUrls((prev) => [...prev, url]);
    setWebsiteUrl("");
  }, [websiteUrl]);

  const addGithubLink = useCallback(() => {
    const url = githubUrl.trim();
    if (!url) return;
    setGithubLinks((prev) => [...prev, { id: crypto.randomUUID(), url }]);
    setGithubUrl("");
  }, [githubUrl]);

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

  const handleFigUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const newAssets: UploadedFile[] = Array.from(e.target.files).map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type,
        size: f.size,
      }));
      setFigFiles((prev) => [...prev, ...newAssets]);
      e.target.value = "";
    },
    [],
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
    const parts: string[] = [];
    parts.push(
      "Set up a design system from the following sources. Analyze each source, extract design tokens (colors, fonts, spacing, borders), and create a cohesive design system.",
    );

    if (companyInfo.trim()) {
      parts.push(`\n## Company / Brand\n${companyInfo.trim()}`);
    }

    if (websiteUrls.length > 0) {
      parts.push(
        `\n## Website URLs\nExtract design tokens from these websites:\n${websiteUrls.map((u) => `- ${u}`).join("\n")}\n\n**Best approach:** Call \`activate-browser\` first, then use chrome-devtools MCP tools to navigate each URL and extract computed styles (colors, fonts, spacing, CSS custom properties) via \`evaluate_script\`. This captures the real rendered design — including JS-injected styles, CSS-in-JS, and SPA content that plain HTML fetch misses. Take a screenshot too for visual reference. If Builder is not connected, fall back to \`import-from-url\` for each URL (limited to static HTML parsing).`,
      );
    }

    if (githubLinks.length > 0) {
      parts.push(
        `\n## GitHub Repositories\nExtract design tokens from code. Call \`import-github\` for each:\n${githubLinks.map((l) => `- ${l.url}`).join("\n")}`,
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

    parts.push(
      `\n---\nAfter processing all sources, call \`create-design-system\` with the combined tokens. Present a summary for review.`,
    );

    openAgentSidebar();
    sendToAgentChat({ message: parts.join("\n"), submit: true, newTab: true });
    navigate("/design-systems");
  }, [
    companyInfo,
    websiteUrls,
    githubLinks,
    codeFiles,
    figFiles,
    docFiles,
    imageFiles,
    assets,
    selectedProjectId,
    notes,
    existingProjects,
    existingSystems,
    navigate,
  ]);

  return (
    <AgentSidebar
      position="right"
      emptyStateText="I'll help set up your design system"
      suggestions={[
        "Analyze my company's website for brand assets",
        "Create a minimal design system",
        "Set up a dark theme design system",
      ]}
    >
      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <button
              onClick={() => navigate("/design-systems")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground/90 cursor-pointer"
            >
              <IconArrowLeft className="w-4 h-4" />
              Back
            </button>
            <Button
              size="sm"
              onClick={handleContinue}
              disabled={!hasAnySources}
              className="cursor-pointer"
            >
              Continue to generation
            </Button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Set up your design system
            </h1>
            <p className="text-sm text-muted-foreground">
              Provide any combination of sources. The more context you give, the
              more accurate the extracted design system will be.
            </p>
          </div>

          <div className="space-y-8">
            {/* Company / Brand */}
            <Section
              title="Company / Brand"
              description="Name, description, and website"
            >
              <Textarea
                value={companyInfo}
                onChange={(e) => setCompanyInfo(e.target.value)}
                placeholder="e.g. Acme Corp — We build developer tools for modern teams..."
                rows={3}
                className="bg-accent/50 border-border"
              />
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <IconWorld className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Website URL
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
                    Add
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
              title="Code"
              description="GitHub repos or local files — the strongest signal for design tokens"
            >
              {/* GitHub */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconBrandGithub className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    GitHub repository
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
                    Add
                  </Button>
                </div>
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
                    Local code files
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
                    Drop CSS, Tailwind config, theme files here — or click to
                    browse
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    .css, .scss, tailwind.config.*, theme.*, tokens.*,
                    package.json
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
              title="Design files"
              description="Figma files, documents, screenshots, brand assets"
            >
              {/* Figma */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconUpload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Figma files
                  </span>
                </div>
                <button
                  onClick={() => figInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    Upload .fig files
                  </p>
                </button>
                <input
                  ref={figInputRef}
                  type="file"
                  accept=".fig"
                  multiple
                  onChange={handleFigUpload}
                  className="hidden"
                />
                <FileList
                  files={figFiles}
                  onRemove={(id) =>
                    setFigFiles((p) => p.filter((f) => f.id !== id))
                  }
                />
              </div>

              {/* Documents */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <IconFileDescription className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Documents & presentations
                  </span>
                </div>
                <button
                  onClick={() => docInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    PPTX, DOCX, PDF, XLSX — brand guides, pitch decks, style
                    docs
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
                    Screenshots & visual references
                  </span>
                </div>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    Product screenshots, mood boards, inspiration images
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
                    Logos, fonts & other assets
                  </span>
                </div>
                <button
                  onClick={() => assetInputRef.current?.click()}
                  className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                >
                  <p className="text-xs text-muted-foreground/70">
                    SVG logos, .woff2 fonts, brand asset files
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
                title="Import from existing"
                description="Fork a design system or extract tokens from a project"
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
                        Design system
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
                        Design project
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Notes */}
            <Section
              title="Additional notes"
              description="Design preferences, constraints, brand guidelines"
            >
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. We prefer a dark theme with high contrast. Our brand uses Poppins for headings and DM Sans for body. Keep corners rounded at 12px..."
                rows={3}
                className="bg-accent/50 border-border"
              />
            </Section>

            {/* Bottom CTA */}
            <div className="pt-4">
              <Button
                onClick={handleContinue}
                disabled={!hasAnySources}
                className="w-full cursor-pointer"
                size="lg"
              >
                Continue to generation
              </Button>
            </div>
          </div>
        </main>
      </div>
    </AgentSidebar>
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
