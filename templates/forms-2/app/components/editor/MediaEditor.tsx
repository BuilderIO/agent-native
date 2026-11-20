import { useT } from "@agent-native/core/client/i18n";
import { resolveEmbed, safeMediaUrl, type Block } from "@shared/form-model";
import { IconX } from "@tabler/icons-react";
import { useState } from "react";

import { MediaBlock } from "@/components/forms/MediaBlock";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ImageUpload } from "./customize/ImageUpload";

type Patch = (patch: Record<string, unknown>) => void;

const EMBED_LABELS = {
  EMBED_VIDEO: "forms.richBlocks.editor.videoLink",
  EMBED_AUDIO: "forms.richBlocks.editor.audioLink",
  EMBED_MAP: "forms.richBlocks.editor.mapLink",
  EMBED_LINK: "forms.richBlocks.editor.embedLink",
} as const;

const tabClass =
  "flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground hover:text-foreground";

function ImagePicker({ block, onPatch }: { block: Block; onPatch: Patch }) {
  const t = useT();
  const [linking, setLinking] = useState(false);
  const url = (block.payload as { url?: string }).url ?? "";
  const showPicker = !safeMediaUrl(url) || linking;
  return (
    <div className="flex flex-col gap-2 py-2">
      {showPicker ? (
        <div className="flex items-center gap-1">
          <ImageUpload
            uploadLabel={t("forms.richBlocks.editor.upload")}
            removeLabel={t("forms.richBlocks.editor.removeImage")}
            url={undefined}
            className="w-24"
            onUploaded={(uploaded) => {
              setLinking(false);
              onPatch({ url: uploaded });
            }}
            onRemove={() => onPatch({ url: undefined })}
          >
            {t("forms.richBlocks.editor.upload")}
          </ImageUpload>
          <button
            type="button"
            className={cn(tabClass, linking && "bg-accent text-foreground")}
            onClick={() => setLinking(true)}
          >
            {t("forms.richBlocks.editor.link")}
          </button>
        </div>
      ) : null}
      {linking ? (
        <Input
          aria-label={t("forms.richBlocks.editor.imageLink")}
          placeholder={t("forms.richBlocks.editor.imageLinkPlaceholder")}
          value={url}
          maxLength={2000}
          onChange={(event) => onPatch({ url: event.target.value })}
        />
      ) : null}
      {showPicker && !linking ? (
        <p className="text-sm text-muted-foreground">
          {t("forms.richBlocks.editor.dropzone")}
        </p>
      ) : null}
      {safeMediaUrl(url) ? (
        <div className="group relative w-fit">
          <MediaBlock block={block} />
          <button
            type="button"
            aria-label={t("forms.richBlocks.editor.removeImage")}
            className="absolute top-3 right-1 hidden size-6 items-center justify-center rounded-full border border-input bg-background shadow-sm group-hover:flex"
            onClick={() => {
              setLinking(false);
              onPatch({ url: undefined });
            }}
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EmbedPicker({
  block,
  kind,
  onPatch,
}: {
  block: Block;
  kind: keyof typeof EMBED_LABELS;
  onPatch: Patch;
}) {
  const t = useT();
  const url = (block.payload as { url?: string }).url ?? "";
  return (
    <div className="flex flex-col gap-2 py-2">
      <Input
        aria-label={t(EMBED_LABELS[kind])}
        placeholder={t("forms.richBlocks.editor.pasteLink")}
        value={url}
        maxLength={2000}
        onChange={(event) => onPatch({ url: event.target.value })}
      />
      {url && !resolveEmbed(kind, url) ? (
        <p className="text-sm text-muted-foreground">
          {t("forms.richBlocks.editor.cannotEmbed")}
        </p>
      ) : null}
      <MediaBlock block={block} />
    </div>
  );
}

/** Editor view of an image or embed block: a link or upload field above its live preview. */
export function MediaEditor({
  block,
  onPatch,
}: {
  block: Block;
  onPatch: Patch;
}) {
  if (block.type === "IMAGE")
    return <ImagePicker block={block} onPatch={onPatch} />;
  if (block.type in EMBED_LABELS)
    return (
      <EmbedPicker
        block={block}
        kind={block.type as keyof typeof EMBED_LABELS}
        onPatch={onPatch}
      />
    );
  return null;
}
