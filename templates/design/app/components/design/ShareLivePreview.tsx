import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconBroadcast } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function ShareLivePreview({
  designId,
  fileId,
  tunnelUrl,
}: {
  designId: string;
  fileId: string;
  tunnelUrl?: string | undefined;
}) {
  const t = useT();
  const [url, setUrl] = useState(tunnelUrl ?? "");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const mutation = useActionMutation("update-visual-edit-preview");
  async function save() {
    setError(undefined);
    try {
      await mutation.mutateAsync({
        designId,
        fileId,
        tunnelUrl: url.trim() || null,
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <IconBroadcast className="size-3.5" />
          {t("designEditor.livePreview.share")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[100010] w-80 space-y-3 data-[state=open]:!animate-none data-[state=closed]:!animate-none"
        align="end"
      >
        <p className="text-xs text-muted-foreground">
          {t("designEditor.livePreview.instructions")}
        </p>
        <Input
          aria-label={t("designEditor.livePreview.tunnelUrl")}
          placeholder="https://example.ngrok-free.app"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={mutation.isPending}
            onClick={() => void save()}
          >
            {t("designEditor.livePreview.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
