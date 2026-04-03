import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import { DEFAULT_STYLE_REFERENCE_URLS } from "@shared/api";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { IconLoader2 } from "@tabler/icons-react";

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
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

export default function ImageGenPanel({
  open,
  onOpenChange,
  slideContext,
  anchorRef,
}: ImageGenPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [disabledDefaults, setDisabledDefaults] = useState<Set<number>>(
    new Set(),
  );
  const { generating, submit: agentSubmit } = useAgentGenerating();
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
    const activeRefs = DEFAULT_STYLE_REFERENCE_URLS.filter(
      (_, i) => !disabledDefaults.has(i),
    );
    const contextParts: string[] = [];

    contextParts.push(
      "Generate 3 image variations using our image generation action (`pnpm action generate-image`).",
    );

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
    }

    if (activeRefs.length > 0) {
      contextParts.push(
        `\nUse these ${activeRefs.length} style reference URLs for brand matching (already configured as defaults in the script).`,
      );
    }

    contextParts.push(
      "\nGenerate 3 variations, show them to the user, and let them pick their favorite. Then insert the chosen image into the slide content in the right place.",
    );

    const label = prompt.trim()
      ? `Generate 3 image variations: ${prompt}`
      : `Generate image for slide ${slideContext ? slideContext.slideIndex + 1 : ""}`;

    agentSubmit(label, contextParts.join("\n"));
    setPrompt("");
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
    style = {
      position: "fixed",
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
      zIndex: 9999,
    };
  }

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="w-80 bg-[hsl(240,5%,10%)] border border-white/[0.1] rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/90">Generate Image</h3>
        <button
          onClick={() => onOpenChange(false)}
          className="text-white/30 hover:text-white/60 transition-colors"
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
                      ? "border-white/[0.04] opacity-25 grayscale"
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
          className="w-full h-16 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-[#609FF8]/50 resize-none"
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
          disabled={generating}
          className="w-full px-4 py-2 rounded-lg bg-[#609FF8] hover:bg-[#7AB2FA] disabled:opacity-70 disabled:cursor-not-allowed text-black text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <IconLoader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            "Generate"
          )}
        </button>
      </div>
    </div>,
    document.body,
  );
}
