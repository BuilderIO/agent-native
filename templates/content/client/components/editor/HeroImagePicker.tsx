import { useState, useRef, useEffect } from "react";
import {
  ImageIcon,
  Upload,
  X,
  Loader2,
  Send,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaUpload } from "@/hooks/use-media-upload";
import { useAgentChatGenerating } from "@agent-native/core";
import { resolveImageReferenceForChat } from "@/lib/image-references";
import { AssetLibraryPicker } from "./AssetLibraryPicker";

interface HeroImagePickerProps {
  heroImage: string | null;
  onChange: (url: string | null) => void;
  projectSlug: string;
  articleContent?: string;
}

type PanelView = "gen" | "library" | null;

export function HeroImagePicker({
  heroImage,
  onChange,
  projectSlug,
  articleContent,
}: HeroImagePickerProps) {
  const [panelView, setPanelView] = useState<PanelView>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, isUploading } = useMediaUpload(projectSlug);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      upload(file).then((result) => {
        if (result) onChange(result.url);
      });
    }
    e.target.value = "";
  };

  const handleLibrarySelect = (url: string) => {
    onChange(url);
    setPanelView(null);
  };

  // No hero image — show trigger
  if (heroImage === null || heroImage === "") {
    return (
      <div className="group mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        {panelView === null ? (
          <button
            onClick={() => setPanelView("gen")}
            className="flex items-center gap-2 py-2 px-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors w-full text-left opacity-0 group-hover:opacity-100"
          >
            <ImageIcon size={14} />
            <span className="text-xs">Add hero image</span>
          </button>
        ) : panelView === "library" ? (
          <AssetLibraryPicker
            projectSlug={projectSlug}
            onSelect={handleLibrarySelect}
            onClose={() => setPanelView(null)}
          />
        ) : (
          <HeroGenPanel
            projectSlug={projectSlug}
            articleContent={articleContent}
            currentImageUrl={null}
            onUpload={() => fileInputRef.current?.click()}
            onLibrary={() => setPanelView("library")}
            isUploading={isUploading}
            onClose={() => setPanelView(null)}
          />
        )}
      </div>
    );
  }

  // Has hero image — show it with hover controls
  return (
    <div className={cn("relative mb-6 rounded-lg group", panelView === null && "overflow-hidden")}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <img
        src={heroImage}
        alt="Hero"
        className="w-full aspect-video object-cover"
      />
      {/* Hover overlay — hide when gen panel is open */}
      <div className={cn(
        "absolute inset-0 bg-black/40 flex items-center justify-center gap-3 transition-opacity",
        panelView !== null ? "opacity-0 pointer-events-none" : "opacity-0 group-hover:opacity-100"
      )}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-white/10 backdrop-blur text-white hover:bg-white/20 transition-colors"
        >
          {isUploading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Upload size={12} />
          )}
          Upload
        </button>
        <button
          onClick={() => setPanelView("library")}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-white/10 backdrop-blur text-white hover:bg-white/20 transition-colors"
        >
          <FolderOpen size={12} />
          Library
        </button>
        <button
          onClick={() => setPanelView("gen")}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-white/10 backdrop-blur text-white hover:bg-white/20 transition-colors"
        >
          Regenerate
        </button>
        <button
          onClick={() => onChange(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-white/10 backdrop-blur text-white hover:bg-white/20 transition-colors"
        >
          <X size={12} />
          Remove
        </button>
      </div>

      {/* Expanded panel below the image */}
      {panelView !== null && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10">
          {panelView === "library" ? (
            <AssetLibraryPicker
              projectSlug={projectSlug}
              onSelect={handleLibrarySelect}
              onClose={() => setPanelView(null)}
            />
          ) : (
            <HeroGenPanel
              projectSlug={projectSlug}
              articleContent={articleContent}
              currentImageUrl={heroImage}
              onUpload={() => fileInputRef.current?.click()}
              onLibrary={() => setPanelView("library")}
              isUploading={isUploading}
              onClose={() => setPanelView(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Hero Gen Panel ─── */

function HeroGenPanel({
  projectSlug,
  articleContent,
  currentImageUrl,
  onUpload,
  onLibrary,
  isUploading,
  onClose,
}: {
  projectSlug: string;
  articleContent?: string;
  currentImageUrl?: string | null;
  onUpload: () => void;
  onLibrary: () => void;
  isUploading: boolean;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, sendToAgentChat] = useAgentChatGenerating();
  const { value: currentImageReference, reason: unresolvedReferenceReason } = resolveImageReferenceForChat(currentImageUrl);
  const isRegenerating = !!currentImageUrl;

  // Auto-close when generation finishes (isGenerating goes from true → false)
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) {
      onClose();
    }
    wasGenerating.current = isGenerating;
  }, [isGenerating, onClose]);

  const handleGenerate = () => {
    if (isGenerating || (isRegenerating && !currentImageReference)) return;

    const referenceImagePaths = currentImageReference ? [currentImageReference] : [];
    const imagePayload = {
      model: "gemini",
      projectSlug,
      preset: "Hero images",
      referenceImagePaths,
      uploadedReferenceImages: [],
    };

    sendToAgentChat({
      message: `${isRegenerating ? "Regenerate this hero image." : "Generate a hero image for this blog post."}${prompt.trim() ? ` ${prompt.trim()}` : ""}`,
      context: [
        `Project: ${projectSlug}`,
        ...(currentImageReference
          ? [
              `Source image reference (pass this exact value through as referenceImagePaths / --reference-image-paths): ${currentImageReference}`,
              `Structured image generation payload:`,
              JSON.stringify(imagePayload, null, 2),
              `Always include the source image reference in every variation so Gemini can refine the existing hero image instead of starting from text only.`,
            ]
          : []),
        `IMPORTANT: Run generate-image exactly ONCE with these flags:`,
        `  --model gemini --preset "Hero images" --project-slug "${projectSlug}"`,
        `The preset passes reference images and style-matching instructions to Gemini automatically.`,
        `Your --prompt should describe a visual concept that represents the article's topic.`,
        `Do NOT describe style/colors in the prompt — the preset handles that.`,
        `Focus the prompt on the SUBJECT: what visual metaphor or scene represents this article?`,
        ``,
        `ASPECT RATIO: Hero images MUST be 16:9. After generating, crop each image to 16:9 using:`,
        `  npm run script -- crop-image --image-path <filename> --project-slug "${projectSlug}" --aspect-ratio 16:9`,
        ``,
        `Full article content (use this to craft a relevant visual concept):`,
        articleContent ?? "(no content yet)",
      ].join("\n"),
      submit: true,
      projectSlug,
      preset: "Hero images",
      referenceImagePaths,
      uploadedReferenceImages: [],
    });
  };

  return (
    <div className="border border-border rounded-lg bg-background">
      <div className="flex justify-end px-3 pt-2">
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={isRegenerating ? "Describe how to refine the current hero image..." : "Describe the hero image you want... (optional)"}
          className="flex w-full rounded-md border border-input bg-muted px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px] resize-y"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
        />

        {isRegenerating && !currentImageReference && unresolvedReferenceReason && (
          <p className="text-[11px] text-amber-600">{unresolvedReferenceReason}</p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Cmd+Enter to generate</span>
          <div className="flex items-center gap-1">
            <button
              onClick={onLibrary}
              className="inline-flex items-center gap-1 justify-center rounded-md text-[11px] font-medium h-7 px-2.5 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <FolderOpen size={11} />
              Library
            </button>
            <button
              onClick={onUpload}
              disabled={isUploading}
              className="inline-flex items-center justify-center rounded-md text-[11px] font-medium h-7 px-2.5 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {isUploading ? <Loader2 size={12} className="animate-spin" /> : "Upload"}
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || (isRegenerating && !currentImageReference)}
              className={cn(
                "inline-flex items-center gap-1.5 justify-center rounded-md text-[11px] font-medium h-7 px-3 transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-50 disabled:pointer-events-none"
              )}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send size={12} />
                  {isRegenerating ? "Regenerate" : "Generate"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
