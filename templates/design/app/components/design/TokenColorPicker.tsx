import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { DesignColorPicker } from "./inspector";

/**
 * Edits one color token through the shared picker. The picker previews
 * locally while a gesture runs and saves once, when the gesture ends; the
 * swatch reverts to the saved value when the save settles or fails.
 */
export function TokenColorPicker({
  name,
  value,
  onCommit,
}: {
  name: string;
  value: string;
  onCommit: (value: string) => Promise<void>;
}) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? value;

  const commit = (next: string) => {
    setPreview(next);
    onCommit(next)
      .catch((error: unknown) => {
        console.warn(`Could not save token color for ${name}`, error);
      })
      .finally(() => setPreview(null));
  };

  return (
    <DesignColorPicker
      className="flex-none leading-none"
      value={shown}
      side="right"
      supportedPaintTypes={["solid"]}
      onChange={setPreview}
      onChangeComplete={commit}
      onChangeCancel={() => setPreview(null)}
      trigger={
        <button
          type="button"
          aria-label={t("designEditor.tokens.editColor", { name })}
          className="size-4 cursor-pointer rounded-[3px] ring-1 ring-inset ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundColor: shown }}
        />
      }
    />
  );
}
