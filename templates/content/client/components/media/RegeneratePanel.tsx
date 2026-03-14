import { useMemo, useState } from "react";
import { Sparkles, X, Loader2 } from "lucide-react";
import { useAgentChatGenerating } from "@agent-native/core";
import { resolveImageReferenceForChat } from "@/lib/image-references";

interface RegeneratePanelProps {
  projectSlug: string;
  currentImageUrl: string;
  preset?: string;
  context?: string;
  onRegenerated: () => void;
  onCancel: () => void;
}

export function RegeneratePanel({
  projectSlug,
  currentImageUrl,
  preset,
  context: extraContext,
  onRegenerated,
  onCancel,
}: RegeneratePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, sendToAgentChat] = useAgentChatGenerating();
  const { value: currentImageReference, reason: unresolvedReferenceReason } =
    useMemo(
      () => resolveImageReferenceForChat(currentImageUrl),
      [currentImageUrl],
    );

  const handleRegenerate = () => {
    if (!prompt.trim() || isGenerating || !currentImageReference) return;

    const referenceImagePaths = [currentImageReference];
    const imagePayload = {
      model: "gemini",
      projectSlug,
      ...(preset ? { preset } : {}),
      referenceImagePaths,
      uploadedReferenceImages: [],
    };

    sendToAgentChat({
      message: `Regenerate this image: ${prompt.trim()}`,
      context: [
        `Project: ${projectSlug}`,
        `Source image reference (pass this exact value through as referenceImagePaths / --reference-image-paths): ${currentImageReference}`,
        `Structured image generation payload:`,
        JSON.stringify(imagePayload, null, 2),
        `IMPORTANT: Run generate-image exactly ONCE with --model gemini --project-slug "${projectSlug}"${preset ? ` --preset "${preset}"` : ""}`,
        `Always include the source image reference in every variation so Gemini can refine the existing image instead of starting from text only.`,
        preset
          ? `Use the preset "${preset}" as supplemental style guidance only.`
          : `Choose the appropriate preset based on image type (hero → "Hero images", inline/diagram → "Daigrams").`,
        ...(extraContext ? [`\n${extraContext}`] : []),
      ].join("\n"),
      submit: true,
      projectSlug,
      preset,
      referenceImagePaths,
      uploadedReferenceImages: [],
    });
    onRegenerated();
  };

  return (
    <div className="bg-neutral-900 border border-white/10 rounded-lg p-4 shadow-2xl space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Regenerate Image</span>
        <button
          onClick={onCancel}
          className="p-1 rounded text-white/50 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the new image you want..."
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary min-h-[70px] resize-y"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
            handleRegenerate();
          }
        }}
      />

      {!currentImageReference && unresolvedReferenceReason && (
        <p className="text-[11px] text-amber-300/80">
          {unresolvedReferenceReason}
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-white/30">Cmd+Enter to generate</span>
        <button
          onClick={handleRegenerate}
          disabled={!prompt.trim() || isGenerating || !currentImageReference}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles size={13} />
              Regenerate
            </>
          )}
        </button>
      </div>
    </div>
  );
}
