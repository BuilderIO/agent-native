import { useState } from "react";
import { Download, Copy, Save, ChevronDown } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useProjects } from "@/hooks/use-projects";
import type { ImageGenResponse } from "@shared/api";

interface GeneratedImageGridProps {
  images: ImageGenResponse[];
}

export function GeneratedImageGrid({ images }: GeneratedImageGridProps) {
  if (images.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Generated Images ({images.length})
      </h2>
      <div className="grid gap-4">
        {images.map((img, i) => (
          <GeneratedImageCard key={i} image={img} />
        ))}
      </div>
    </div>
  );
}

function GeneratedImageCard({ image }: { image: ImageGenResponse }) {
  const [copied, setCopied] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);

  const modelLabel =
    image.model === "openai"
      ? "OpenAI GPT Image"
      : image.model === "flux"
        ? "Flux Kontext Pro"
        : "Gemini Flash";

  const handleCopy = () => {
    const url = image.savedPath || image.url;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="relative group">
        <img
          src={image.url}
          alt={image.prompt}
          className="w-full object-contain bg-muted/30"
          style={{ maxHeight: 512 }}
        />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md bg-background/80 backdrop-blur text-foreground hover:bg-background transition-colors"
            title={copied ? "Copied!" : "Copy URL"}
          >
            <Copy size={14} />
          </button>
          <button
            onClick={async (e) => {
              e.preventDefault();
              try {
                const response = await fetch(image.url);
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = `generated-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
              } catch {
                // Fallback
                const a = document.createElement("a");
                a.href = image.url;
                a.download = `generated-${Date.now()}.png`;
                a.target = "_blank";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }
            }}
            className="p-1.5 rounded-md bg-background/80 backdrop-blur text-foreground hover:bg-background transition-colors"
            title="Download"
          >
            <Download size={14} />
          </button>
          <SaveToProjectButton image={image} />
        </div>
      </div>
      <div className="px-3 py-2 border-t border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{modelLabel}</span>
          {image.savedPath && (
            <span className="text-[10px] text-green-500">Saved to project</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {image.prompt}
        </p>
      </div>
    </div>
  );
}

function SaveToProjectButton({ image }: { image: ImageGenResponse }) {
  const [open, setOpen] = useState(false);
  const { data: projectsData } = useProjects();
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  const handleSave = async (projectSlug: string) => {
    setSaving(true);
    try {
      // Re-generate with projectSlug to save, or just download + upload
      // For simplicity, we'll fetch the image and upload it as media
      const res = await fetch(image.url);
      const blob = await res.blob();
      const formData = new FormData();
      formData.append("file", blob, `gen-${Date.now()}.png`);

      const uploadRes = await authFetch(`/api/projects/${projectSlug}/media`, {
        method: "POST",
        body: formData,
      });
      if (uploadRes.ok) {
        setSavedTo(projectSlug.split("/").pop() || projectSlug);
      }
    } catch {
      // silent fail
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  if (savedTo) {
    return (
      <span className="px-2 py-1.5 rounded-md bg-green-500/80 backdrop-blur text-white text-[11px]">
        Saved
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md bg-background/80 backdrop-blur text-foreground hover:bg-background transition-colors"
        title="Save to project"
      >
        <Save size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-md border border-border bg-popover shadow-lg py-1 max-h-48 overflow-y-auto scrollbar-thin">
            {projectsData?.projects.map((p) => (
              <button
                key={p.slug}
                onClick={() => handleSave(p.slug)}
                disabled={saving}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors truncate"
              >
                {p.name}
              </button>
            ))}
            {(!projectsData?.projects.length) && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No projects</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
