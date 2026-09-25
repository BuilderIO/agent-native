import { openAgentSettings } from "@agent-native/core/client/command-navigation";
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { parseFigmaFileKey } from "@shared/figma-url";
import { IconUpload } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importResultNotification } from "@/lib/design-import";
import { FIGMA_ACCESS_TOKEN_SECRET_KEY } from "@/lib/figma-connection";
import { setPendingDesignImport } from "@/lib/pending-import";

export function HomeImportButton() {
  const t = useT();
  const navigate = useNavigate();
  const create = useActionMutation("create-design");
  const importFrame = useActionMutation("import-figma-frame");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const valid = file
    ? file.name.toLowerCase().endsWith(".fig")
    : Boolean(parseFigmaFileKey(url));
  const changeOpen = (next: boolean) => {
    if (pending.current) return;
    setOpen(next);
    if (!next) {
      setUrl("");
      setFile(undefined);
      setError(undefined);
    }
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <IconUpload />
          {t("home.importFromFigma")}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("home.importFromFigma")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || pending.current) return;
            pending.current = true;
            setBusy(true);
            setError(undefined);
            try {
              if (!file) {
                const result = await importFrame.mutateAsync({
                  figmaUrl: url.trim(),
                  createNew: true,
                });
                if (!result.designId || !result.files?.length)
                  throw new Error(
                    t("designEditor.import.errors.figmaImportFailed"),
                  );
                const notification = importResultNotification(
                  result,
                  t("designEditor.import.figmaUrlSuccess"),
                );
                toast[notification.variant](notification.title, {
                  description: notification.description,
                });
                setOpen(false);
                void navigate(`/design/${result.designId}`);
                return;
              }
              const result = await create.mutateAsync({
                title:
                  file?.name.replace(/\.fig$/i, "") || t("home.untitledDesign"),
                projectType: "prototype",
                designSystemId: null,
              });
              if (!result.id) throw new Error(t("home.failedToCreateDesign"));
              setPendingDesignImport(result.id, { kind: "file", file });
              setOpen(false);
              void navigate(`/design/${result.id}?panel=import`);
            } catch (cause) {
              setError(
                actionErrorMessage(cause) ??
                  t("designEditor.import.errors.importFailed"),
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="home-figma-url">
              {t("designEditor.import.figmaUrlLabel")}
            </Label>
            <Input
              id="home-figma-url"
              type="url"
              value={url}
              placeholder={t("designEditor.import.figmaUrlPlaceholder")}
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                setFile(undefined);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="home-figma-file">{t("home.figmaFile")}</Label>
            <Input
              id="home-figma-file"
              type="file"
              accept=".fig"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0]);
                setUrl("");
              }}
            />
          </div>
          {error ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    openAgentSettings(
                      `secrets:${FIGMA_ACCESS_TOKEN_SECRET_KEY}`,
                    );
                  }}
                >
                  {t("settings.openAgentSettings")}
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => changeOpen(false)}
            >
              {t("home.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {file
                ? t("home.openImport")
                : t("designEditor.import.importFigmaUrl")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
