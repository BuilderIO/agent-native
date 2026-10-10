import { useT } from "@agent-native/core/client/i18n";
import type { EffectTextureRef } from "@shared/native-effects";
import { IconPhoto } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";

import { ImageFillControls } from "./ImageFillControls";
import { InspectorControlPopoverContent } from "./InspectorControlPopover";
import { createNativeTextureUploader } from "./native-texture-upload-client";

export function NativeEffectTextureControl({
  label,
  value,
  disabled,
  onChange,
  designId,
  fileId,
}: {
  label: string;
  value: EffectTextureRef | null;
  disabled: boolean;
  onChange: (value: EffectTextureRef | null) => void;
  designId?: string;
  fileId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const uploadImage = useMemo(
    () =>
      designId && fileId ? createNativeTextureUploader(designId, fileId) : null,
    [designId, fileId],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          className="h-6 w-full justify-start gap-2 px-2 text-xs"
        >
          <IconPhoto className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {value?.url || t("editPanel.shaders.nativeTextureSelect")}
          </span>
        </Button>
      </PopoverTrigger>
      <InspectorControlPopoverContent
        title={label}
        icon={<IconPhoto className="size-4" />}
        onClose={() => setOpen(false)}
        bodyClassName="p-0"
      >
        <ImageFillControls
          sourceOnly
          uploadImage={(data, filename) => {
            if (!uploadImage)
              throw new Error(
                "Native texture upload needs a selected Design file.",
              );
            return uploadImage(data, filename);
          }}
          maxUploadBytes={1_000_000}
          uploadLimitMessage={t("editPanel.shaders.nativeTextureTooLarge")}
          value={{ url: value?.url ?? "", fit: "fill" }}
          disabled={disabled}
          onChange={({ url }) =>
            onChange(url.trim() ? { kind: "asset", url: url.trim() } : null)
          }
        />
      </InspectorControlPopoverContent>
    </Popover>
  );
}
