import { useT } from "@agent-native/core/client/i18n";
import {
  resolveEmbed,
  safeMediaUrl,
  type Block,
  type EmbedKind,
} from "@shared/form-model";

import { cn } from "@/lib/utils";

const FRAME_HEIGHT: Record<EmbedKind, string> = {
  EMBED_VIDEO: "aspect-video",
  EMBED_AUDIO: "h-[152px]",
  EMBED_MAP: "h-[360px]",
  EMBED_LINK: "h-[360px]",
};

/** An image or embed block as a respondent sees it; renders nothing until its link is usable. */
export function MediaBlock({ block }: { block: Block }) {
  const t = useT();
  const url = (block.payload as { url?: unknown }).url;
  if (block.type === "IMAGE") {
    const src = safeMediaUrl(url);
    const alt = (block.payload as { alt?: string }).alt ?? "";
    return src ? (
      <div className="py-2">
        <img src={src} alt={alt} className="max-w-full rounded-lg" />
      </div>
    ) : null;
  }
  if (!(block.type in FRAME_HEIGHT)) return null;
  const kind = block.type as EmbedKind;
  const embed = resolveEmbed(kind, url);
  if (!embed) return null;
  return (
    <div className="py-2">
      <iframe
        src={embed.src}
        title={t("forms.richBlocks.embedTitle")}
        loading="lazy"
        referrerPolicy="no-referrer"
        allowFullScreen
        sandbox={
          embed.trusted
            ? "allow-scripts allow-same-origin allow-presentation allow-popups"
            : "allow-scripts allow-popups allow-forms"
        }
        className={cn(
          "w-full rounded-lg border-0 bg-muted",
          FRAME_HEIGHT[kind],
        )}
      />
    </div>
  );
}
