import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FolderPlus, FolderOpen, Check, AlertCircle } from "lucide-react";
import { useProjects, useCreateFile } from "@/hooks/use-projects";
import type { CollectedLink } from "@shared/api";
import TurndownService from "turndown";

interface SaveLinksToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: CollectedLink[];
  onSaved: () => void;
  defaultProjectSlug?: string;
  currentWorkspace?: string;
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
// Remove script/style/nav/footer noise
turndown.remove(["script", "style", "nav", "footer", "iframe", "noscript"]);

/** Convert webview HTML to markdown using Turndown (client-side) */
function htmlToMarkdown(html: string, link: CollectedLink): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Try to find the main content area
  const main =
    doc.querySelector("article") ||
    doc.querySelector("main") ||
    doc.querySelector("[role=main]") ||
    doc.body;

  let md = turndown.turndown(main.innerHTML);

  // Prepend title and source
  const header = [
    `# ${link.title}`,
    "",
    `Source: ${link.url}`,
    link.tweetAuthor ? `Found via ${link.tweetAuthor}` : "",
    "",
    "---",
    "",
  ].filter(Boolean).join("\n");

  return header + md;
}

async function fetchLinkMarkdown(link: CollectedLink): Promise<string> {
  const url = link.url;

  // If we have webview HTML, convert directly — no backend fetch needed
  if (link.html) {
    return htmlToMarkdown(link.html, link);
  }

  try {
    // YouTube: fetch transcript
    if (isYouTubeUrl(url)) {
      const res = await authFetch(`/api/youtube/transcript?url=${encodeURIComponent(url)}`);
      if (res.ok) {
        const data = await res.json();
        const lines = [
          `# ${data.title}`,
          "",
          `Source: ${data.url}`,
          link.tweetAuthor ? `Found via ${link.tweetAuthor}` : "",
          "",
          "---",
          "",
          "## Transcript",
          "",
          data.transcript,
        ].filter(Boolean);
        return lines.join("\n");
      }
      // Fall through to regular fetch if transcript fails
    }

    // Regular URL: fetch as markdown
    const res = await authFetch(`/api/twitter/fetch-markdown?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      let md = data.markdown as string;
      if (link.tweetAuthor && !md.includes(link.tweetAuthor)) {
        md += `\n\n---\n\n*Found via ${link.tweetAuthor}*`;
      }
      return md;
    }
  } catch {
    // Fall through to basic summary
  }

  // Fallback: basic summary
  const lines = [
    `# ${link.title}`,
    "",
    `Source: ${url}`,
    `Domain: ${link.domain}`,
    link.description ? `\n${link.description}` : "",
    link.tweetAuthor ? `\n*Found via ${link.tweetAuthor}*` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function SaveLinksToProjectDialog({
  open,
  onOpenChange,
  links,
  onSaved,
  defaultProjectSlug,
  currentWorkspace,
}: SaveLinksToProjectDialogProps) {
  const { data: projectsData } = useProjects();
  const createFile = useCreateFile();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedProject, setSelectedProject] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const projects = projectsData?.projects ?? [];

  // Pre-select project from prop when dialog opens
  useEffect(() => {
    if (open && defaultProjectSlug) {
      setSelectedProject(defaultProjectSlug);
      setMode("existing");
    }
  }, [open, defaultProjectSlug]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setProgress(null);
      setErrors([]);
    }
  }, [open]);

  const handleSave = async () => {
    const slug = mode === "existing" ? selectedProject : "";
    if (mode === "existing" && !slug) return;
    if (mode === "new" && !newName.trim()) return;

    setSaving(true);
    setProgress({ done: 0, total: links.length });
    setErrors([]);

    try {
      let targetSlug: string;

      if (mode === "new") {
        // Create the project and use the server-returned slug
        const group = currentWorkspace || "";
        const createRes = await authFetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), group }),
        });
        if (!createRes.ok) {
          throw new Error("Failed to create project");
        }
        const createData = await createRes.json();
        targetSlug = createData.slug;
      } else {
        targetSlug = selectedProject;
      }

      // Fetch and save each link as its own markdown file
      const linkErrors: string[] = [];
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        setProgress({ done: i, total: links.length });

        try {
          const markdown = await fetchLinkMarkdown(link);
          const fileName = `${slugifyTitle(link.title || link.domain)}.md`;

          await createFile.mutateAsync({
            projectSlug: targetSlug,
            name: fileName,
            type: "file",
            parentPath: "resources/research",
            content: markdown,
          });
        } catch (err: any) {
          linkErrors.push(`${link.title}: ${err.message}`);
        }
      }

      setProgress({ done: links.length, total: links.length });

      if (linkErrors.length > 0) {
        setErrors(linkErrors);
      }

      // Small delay so user sees 100%
      await new Promise((r) => setTimeout(r, 400));
      onSaved();
    } catch (err) {
      console.error("Failed to save links:", err);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const canSave =
    (mode === "existing" && selectedProject) ||
    (mode === "new" && newName.trim());

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Collected Links</DialogTitle>
          <DialogDescription>
            Save {links.length} link{links.length !== 1 ? "s" : ""} as markdown
            to a project. Full page content will be fetched for each link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setMode("existing")}
              disabled={saving}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                mode === "existing"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              <FolderOpen size={13} />
              Existing Project
            </button>
            <button
              onClick={() => setMode("new")}
              disabled={saving}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                mode === "new"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              <FolderPlus size={13} />
              New Project
            </button>
          </div>

          {mode === "existing" ? (
            <Select
              value={selectedProject}
              onValueChange={setSelectedProject}
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name..."
              disabled={saving}
            />
          )}

          {/* Progress indicator */}
          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {progress.done < progress.total ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Check size={12} className="text-green-500" />
                  )}
                  Fetching content...
                </span>
                <span>
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="text-xs text-destructive space-y-1">
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 size={14} className="animate-spin mr-1.5" />}
            {saving ? "Saving..." : "Save as Markdown"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
