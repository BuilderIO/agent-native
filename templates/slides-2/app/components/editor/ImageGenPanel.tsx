import { useT } from "@agent-native/core/client/i18n";
import {
  PromptComposer,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/app/chat/composer/index";
import {
  DEFAULT_STYLE_REFERENCE_URLS,
  normalizeReferenceUrls,
} from "@shared/api";
import { IconX } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { WEBSITE_STYLE_REFERENCE_DIRECTIVE } from "@/lib/create-deck-generation";

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
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export interface BuildImageGenerationContextArgs {
  prompt: string;
  slideContext?: ImageGenPanelProps["slideContext"];
  referenceImageUrls?: string[];
}

export function getImageGenerationLabel(
  prompt: string,
  slideIndex?: number,
): string {
  return prompt.trim()
    ? prompt
    : `Generate image for slide ${slideIndex === undefined ? "" : slideIndex + 1}`;
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
  contextParts.push(WEBSITE_STYLE_REFERENCE_DIRECTIVE);

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
    slideContext
      ? `\nGenerate 3 preview-only variations. Show each as an inline rendered image preview using markdown image syntax (![Variation 1](url)), not a plain text link. After the user chooses one, call \`generate-image-api\` with generatedImageUrl set to that preview URL, insertIntoSlide: true, deckId: "${slideContext.deckId}", slideId: "${slideContext.slideId}", and the original prompt. This registers the chosen image and saves source-backed slides with revision-checked source edits. For a direct one-image request, call \`generate-image-api\` with insertIntoSlide: true plus the same deckId and slideId. Claim it was added only if the action returns inserted: true.`
      : "\nGenerate 3 preview-only variations. Show each as an inline rendered image preview using markdown image syntax (![Variation 1](url)), not a plain text link. After the user chooses one, identify the target deck and slide, then call `generate-image-api` with generatedImageUrl set to that preview URL, insertIntoSlide: true, both IDs, and the original prompt. This registers the chosen image and saves source-backed slides with revision-checked source edits. Claim it was added only if the action returns inserted: true.",
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
  const [disabledDefaults, setDisabledDefaults] = useState<Set<number>>(
    new Set(),
  );
  const { submit: agentSubmit } = useAgentGenerating();
  const composerRef = useRef<TiptapComposerHandle>(null);
  const virtualAnchor = useMemo(
    () => ({
      current: {
        get contextElement() {
          return anchorRef?.current ?? document.body;
        },
        getBoundingClientRect: () =>
          anchorRef?.current?.getBoundingClientRect() ??
          new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0),
      },
    }),
    [anchorRef],
  );

  const toggleDefaultRef = (index: number) => {
    setDisabledDefaults((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleGenerate = (prompt: string) => {
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

    const label = getImageGenerationLabel(prompt, slideContext?.slideIndex);

    agentSubmit(label, context);
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(20rem,calc(100vw-24px))] overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t("editorToolbar.generateImage")}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={t("comments.close")}
          >
            <IconX className="size-4" />
          </Button>
        </div>

        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {DEFAULT_STYLE_REFERENCE_URLS.map((url, i) => {
              const disabled = disabledDefaults.has(i);
              return (
                <Button
                  key={url}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-pressed={!disabled}
                  aria-label={`${t("editorToolbar.generateImage")} ${i + 1}`}
                  onClick={() => toggleDefaultRef(i)}
                  className={`relative size-10 overflow-hidden rounded border p-0 transition-all ${
                    disabled
                      ? "border-border opacity-25 grayscale"
                      : "border-[hsl(var(--slides-accent)/0.4)]"
                  }`}
                >
                  <img src={url} alt="" className="size-full object-cover" />
                  {disabled && (
                    <span className="absolute inset-0 bg-foreground/40" />
                  )}
                </Button>
              );
            })}
          </div>

          <PromptComposer
            composerRef={composerRef}
            autoFocus
            attachmentsEnabled={false}
            showModelSelector={false}
            voiceEnabled={false}
            plusMenuMode="hidden"
            layoutVariant="compact"
            placeholder={t("raw.describeImagePlaceholder")}
            onSubmit={(text) => handleGenerate(text)}
            onEmptySubmit={() => handleGenerate("")}
            actionButton={
              <Button
                type="button"
                onClick={() => void composerRef.current?.submit?.()}
              >
                {t("raw.generate")}
              </Button>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
