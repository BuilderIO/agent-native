import { useT } from "@agent-native/core/client/i18n";
import {
  DEFAULT_STYLE_REFERENCE_URLS,
  normalizeReferenceUrls,
} from "@shared/api";
import { IconX } from "@tabler/icons-react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useAgentGenerating } from "@/hooks/use-agent-generating";

interface ImageGenPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slideContext?: {
    slideId: string;
    slideIndex: number;
    slideContent: string;
    slideLayout: string;
    deckId: string;
    deckTitle: string;
  };
  referenceImageUrls?: string[];
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

export interface BuildImageGenerationContextArgs {
  prompt: string;
  slideContext?: ImageGenPanelProps["slideContext"];
  referenceImageUrls?: string[];
}

export function buildImageGenerationContext({
  prompt,
  slideContext,
  referenceImageUrls = [],
}: BuildImageGenerationContextArgs): string {
  const contextParts: string[] = [];

  contextParts.push(
    "Generate 3 image variations by calling the registered `generate-image-api` action three times with the same prompt. That action delegates to the Assets app so the images come from the brand library; never call an image-generation API directly from slides.",
  );
  contextParts.push(
    "The deliverables must be actual generated image assets from the action. Do not create placeholder HTML/CSS, oversized icon compositions, inline SVGs, or text-only mockups.",
  );
  contextParts.push(
    "Do not render visible words, labels, spec text, prompt text, or UI copy inside the image unless the user's image prompt explicitly asks for exact text.",
  );
  contextParts.push(
    'Do not browse, search, or inspect brand assets for style phrases like "Builder.io" unless the user explicitly asks to set up, import, save, or apply a brand/design system.',
  );

  const styleReferenceUrls = normalizeReferenceUrls(referenceImageUrls);
  if (styleReferenceUrls.length > 0) {
    contextParts.push(
      `Call \`generate-image-api\` with referenceImageUrls set to this exact array: ${JSON.stringify(styleReferenceUrls)}.`,
    );
  }

  if (prompt.trim()) {
    contextParts.push(`Image prompt: "${prompt}"`);
  } else {
    contextParts.push(
      "Generate an appropriate image based on the slide content below.",
    );
  }

  if (slideContext) {
    contextParts.push(
      `\nTarget: Slide ${slideContext.slideIndex + 1} (id: ${slideContext.slideId}) in deck "${slideContext.deckTitle}" (id: ${slideContext.deckId}).`,
    );
    contextParts.push(`Current slide layout: ${slideContext.slideLayout}`);
    contextParts.push(
      `Current slide content:\n\`\`\`\n${slideContext.slideContent}\n\`\`\``,
    );
    contextParts.push(
      `Pass deckId, slideId, slideContent, and referenceImageUrls to the action so Assets can ground the generation in this slide.`,
    );
  }

  contextParts.push(
    '\nGenerate 3 variations. Show each as an inline rendered image preview using markdown image syntax (![Variation 1](url)), not a plain text link — the chat renders "![]()" as an actual image but "[]()" as a bare link. Let the user pick their favorite, then insert the chosen generated image into the slide content in the right place.',
  );

  return contextParts.join("\n");
}

export default function ImageGenPanel({
  open,
  onOpenChange,
  slideContext,
  referenceImageUrls = [],
  anchorRef,
}: ImageGenPanelProps) {
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [disabledDefaults, setDisabledDefaults] = useState<Set<number>>(
    new Set(),
  );
  const { submit: agentSubmit } = useAgentGenerating();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onOpenChange]);

  const toggleDefaultRef = (index: number) => {
    setDisabledDefaults((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleGenerate = () => {
    const activeDefaultRefs = DEFAULT_STYLE_REFERENCE_URLS.filter(
      (_, i) => !disabledDefaults.has(i),
    );
    const activeRefs = normalizeReferenceUrls([
      ...activeDefaultRefs,
      ...referenceImageUrls,
    ]);
    const context = buildImageGenerationContext({
      prompt,
      slideContext,
      referenceImageUrls: activeRefs,
    });

    const label = prompt.trim()
      ? `Generate 3 image variations: ${prompt}`
      : `Generate image for slide ${slideContext ? slideContext.slideIndex + 1 : ""}`;

    agentSubmit(label, context);
    setPrompt("");
    // Generation happens asynchronously in the agent chat, which already
    // surfaces its own progress/failure state — keeping this popup open with
    // a separate loading flag risks it getting stuck if the two states
    // diverge (e.g. the chat run keeps going after this request finishes).
    onOpenChange(false);
  };

  if (!open) return null;

  // Position below anchor button
  let style: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 9999,
  };

  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    if (vw < 640) {
      style = {
        position: "fixed",
        top: rect.bottom + 8,
        left: 12,
        right: 12,
        zIndex: 9999,
      };
    } else {
      style = {
        position: "fixed",
        top: rect.bottom + 8,
        right: Math.max(8, vw - rect.right),
        zIndex: 9999,
      };
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="w-[min(20rem,calc(100vw-24px))] bg-popover border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {t("editorToolbar.generateImage")}
        </h3>
        <button
          onClick={() => onOpenChange(false)}
          className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          aria-label="Close"
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Style References */}
        <div>
          <div className="flex flex-wrap gap-1.5">
            {DEFAULT_STYLE_REFERENCE_URLS.map((url, i) => {
              const disabled = disabledDefaults.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggleDefaultRef(i)}
                  className={`relative w-10 h-10 rounded overflow-hidden border transition-all ${
                    disabled
                      ? "border-border opacity-25 grayscale"
                      : "border-[#609FF8]/40"
                  }`}
                >
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {disabled && <div className="absolute inset-0 bg-black/40" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe image (optional)..."
          className="w-full h-16 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-[#609FF8]/50 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleGenerate();
            }
          }}
        />

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          className="w-full px-4 py-2 rounded-lg bg-[#609FF8] hover:bg-[#7AB2FA] text-black text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          Generate
        </button>
      </div>
    </div>,
    document.body,
  );
}
