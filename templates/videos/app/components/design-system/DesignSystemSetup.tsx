import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  IconUpload,
  IconWorld,
  IconPalette,
  IconLoader2,
  IconBrandGithub,
  IconFolder,
  IconX,
  IconFileDescription,
  IconPhoto,
  IconCheck,
} from "@tabler/icons-react";
import {
  useActionQuery,
  sendToAgentChat,
  openAgentSidebar,
} from "@agent-native/core/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

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

export function DesignSystemSetup({
  open,
  onClose,
  onComplete,
  editingId,
}: DesignSystemSetupProps) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLinks, setGithubLinks] = useState<GitHubLink[]>([]);
  const [codeFiles, setCodeFiles] = useState<UploadedFile[]>([]);
  const [docFiles, setDocFiles] = useState<UploadedFile[]>([]);
  const [imageFiles, setImageFiles] = useState<UploadedFile[]>([]);
  const [brandNotes, setBrandNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  const codeInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { data: existingDs } = useActionQuery<{
    title?: string;
    description?: string;
    data?: string | null;
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
      setSelectedSystemId("");
    }
  }, [open]);

  const hasAnySources = useMemo(() => {
    return (
      companyName.trim() ||
      websiteUrls.length > 0 ||
      githubLinks.length > 0 ||
      codeFiles.length > 0 ||
      docFiles.length > 0 ||
      imageFiles.length > 0 ||
      selectedSystemId ||
      brandNotes.trim()
    );
  }, [
    companyName,
    websiteUrls,
    githubLinks,
    codeFiles,
    docFiles,
    imageFiles,
    selectedSystemId,
    brandNotes,
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

  const handleEditSave = async () => {
    if (!editingId) return;
    setGenerating(true);
    try {
      const res = await fetch("/_agent-native/actions/update-design-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          title: companyName || "My Brand",
          description: brandNotes || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      onComplete();
      toast({ title: "Design system updated" });
    } catch {
      toast({
        title: "Failed to update",
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

    const parts: string[] = [];
    parts.push(
      "Set up a design system from the following sources. Analyze each source, extract design tokens (colors, fonts, spacing, borders), and create a cohesive design system for my slide decks.",
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
        `\n## GitHub Repositories\nExtract design tokens from code. Call \`import-github\` for each:\n${githubLinks.map((l) => `- ${l.url}`).join("\n")}`,
      );
    }

    if (codeFiles.length > 0) {
      const withContent = codeFiles.filter((f) => f.textContent);
      if (withContent.length > 0) {
        parts.push(
          `\n## Code Files (${withContent.length} files)\nCall \`import-code\` with these files:`,
        );
        for (const f of withContent) {
          parts.push(
            `\n### ${f.name}\n\`\`\`\n${f.textContent!.slice(0, 5000)}\n\`\`\``,
          );
        }
      }
    }

    if (docFiles.length > 0) {
      parts.push(
        `\n## Documents\nExtract brand cues. Call \`import-document\` with metadata:\n${docFiles.map((f) => `- ${f.name} (${f.type}, ${formatSize(f.size)})`).join("\n")}`,
      );
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

    parts.push(
      `\n---\nAfter processing all sources, call \`create-design-system\` with the combined tokens. Present a summary for review.`,
    );

    openAgentSidebar();
    sendToAgentChat({ message: parts.join("\n"), submit: true });
    onComplete();
  }, [
    editingId,
    companyName,
    websiteUrls,
    githubLinks,
    codeFiles,
    docFiles,
    imageFiles,
    selectedSystemId,
    existingSystems,
    brandNotes,
    onComplete,
  ]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] p-0 bg-card border-border">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-foreground/90 flex items-center gap-2">
            <IconPalette className="w-5 h-5 text-[#609FF8]" />
            {editingId ? "Edit Design System" : "New Design System"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {editingId
              ? "Update your brand identity."
              : "Provide any combination of sources — the more context, the better the result."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-160px)] px-6">
          <div className="space-y-5 py-4">
            {/* Company Name */}
            <div className="space-y-2">
              <Label className="text-foreground/70">Company / Brand</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc. — We build developer tools..."
                className="bg-accent/50 border-border text-foreground/90 placeholder:text-muted-foreground/60"
              />
            </div>

            {!editingId && (
              <>
                {/* Website URL */}
                <div className="space-y-2">
                  <Label className="text-foreground/70 flex items-center gap-1.5">
                    <IconWorld className="w-3.5 h-3.5" />
                    Website URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="bg-accent/50 border-border text-foreground/90 placeholder:text-muted-foreground/60"
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
                      Add
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
                  <Label className="text-foreground/70 flex items-center gap-1.5">
                    <IconBrandGithub className="w-3.5 h-3.5" />
                    GitHub Repository
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/org/repo"
                      className="bg-accent/50 border-border text-foreground/90 placeholder:text-muted-foreground/60"
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
                      Add
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
                  <Label className="text-foreground/70 flex items-center gap-1.5">
                    <IconFolder className="w-3.5 h-3.5" />
                    Code Files
                  </Label>
                  <button
                    onClick={() => codeInputRef.current?.click()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files)
                        readTextFiles(e.dataTransfer.files, setCodeFiles);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                  >
                    <p className="text-xs text-muted-foreground/70">
                      CSS, Tailwind config, theme files — drop or click
                    </p>
                  </button>
                  <input
                    ref={codeInputRef}
                    type="file"
                    multiple
                    accept=".css,.scss,.sass,.less,.ts,.tsx,.js,.jsx,.json,.html"
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
                  <Label className="text-foreground/70 flex items-center gap-1.5">
                    <IconFileDescription className="w-3.5 h-3.5" />
                    Documents & Presentations
                  </Label>
                  <button
                    onClick={() => docInputRef.current?.click()}
                    className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                  >
                    <p className="text-xs text-muted-foreground/70">
                      PPTX, DOCX, PDF — brand guides, pitch decks
                    </p>
                  </button>
                  <input
                    ref={docInputRef}
                    type="file"
                    accept=".pptx,.ppt,.docx,.doc,.pdf,.xlsx,.xls"
                    multiple
                    onChange={(e) => {
                      if (!e.target.files) return;
                      const newFiles = Array.from(e.target.files).map((f) => ({
                        id: crypto.randomUUID(),
                        name: f.name,
                        type: f.type || f.name.split(".").pop() || "",
                        size: f.size,
                      }));
                      setDocFiles((p) => [...p, ...newFiles]);
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
                  <Label className="text-foreground/70 flex items-center gap-1.5">
                    <IconPhoto className="w-3.5 h-3.5" />
                    Screenshots & Visual References
                  </Label>
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-foreground/15 cursor-pointer"
                  >
                    <p className="text-xs text-muted-foreground/70">
                      Product screenshots, mood boards, logos
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
                    <Label className="text-foreground/70">
                      Fork an existing design system
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
                                : "border-border bg-muted/50 hover:border-border"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <IconPalette className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-sm text-foreground/70 truncate">
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
              <Label className="text-foreground/70">
                {editingId ? "Brand Notes" : "Additional Notes"}
              </Label>
              <Textarea
                value={brandNotes}
                onChange={(e) => setBrandNotes(e.target.value)}
                placeholder="Design preferences, constraints, brand guidelines..."
                rows={3}
                className="bg-accent/50 border-border text-foreground/90 placeholder:text-muted-foreground/60 resize-none"
              />
            </div>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 pb-6 pt-2 border-t border-border">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={generating}
            className="text-muted-foreground hover:text-foreground/80 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={editingId ? generating : !hasAnySources}
            className="cursor-pointer"
          >
            {generating ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : editingId ? (
              "Save Changes"
            ) : (
              "Continue to generation"
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
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5"
        >
          <IconCheck className="w-3.5 h-3.5 text-green-400/60 shrink-0" />
          <span className="truncate flex-1">{item}</span>
          <button
            onClick={() => onRemove(i)}
            className="text-muted-foreground/70 hover:text-muted-foreground shrink-0 cursor-pointer"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
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
  if (files.length === 0) return null;
  return (
    <div className="space-y-1">
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
