import { openAgentSettings } from "@agent-native/core/client/command-navigation";
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { parseFigmaFileKey } from "@shared/figma-url";
import { IconChevronDown, IconUpload } from "@tabler/icons-react";
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { validateFigUploadFile } from "@/lib/design-file-upload";
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
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const openLinkAfterMenu = useRef(false);
  const urlId = useId();
  const valid = Boolean(parseFigmaFileKey(url));
  const changeOpen = (next: boolean) => {
    if (!pending.current) setOpen(next);
  };
  const pickFile = () => {
    if (pending.current) return;
    setOpen(false);
    fileInput.current?.click();
  };
  const importFile = async (file: File | undefined) => {
    if (!file || pending.current) return;
    if (validateFigUploadFile(file, { maxBytes: null })) {
      toast.error(t("designEditor.import.errors.invalidFigFile"));
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const result = await create.mutateAsync({
        title: file.name.replace(/\.fig$/i, "") || t("home.untitledDesign"),
        projectType: "prototype",
        designSystemId: null,
      });
      if (!result.id) throw new Error(t("home.failedToCreateDesign"));
      setPendingDesignImport(result.id, { kind: "file", file });
      void navigate(`/design/${result.id}?panel=import`);
    } catch (cause) {
      toast.error(actionErrorMessage(cause) ?? t("home.failedToCreateDesign"), {
        action: {
          label: t("homeContext.retry"),
          onClick: () => void importFile(file),
        },
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".fig"
        hidden
        aria-label={t("home.figmaFile")}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void importFile(file);
        }}
      />
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverAnchor asChild>
          <ButtonGroup aria-label={t("home.import")}>
            <Button
              size="sm"
              disabled={busy}
              aria-label={t("home.import")}
              onClick={pickFile}
            >
              <IconUpload />
              <span className="design-home-import-label">
                {t("home.import")}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuTrigger}
                  size="sm"
                  disabled={busy}
                  aria-label={t("home.importOptions")}
                >
                  <IconChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (!openLinkAfterMenu.current) return;
                  event.preventDefault();
                  openLinkAfterMenu.current = false;
                  setOpen(true);
                }}
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={pickFile}>
                    {t("home.figmaFile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      openLinkAfterMenu.current = true;
                    }}
                  >
                    {t("home.figmaLink")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </PopoverAnchor>
        <PopoverContent
          align="end"
          aria-label={t("home.figmaLink")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuTrigger.current?.focus();
          }}
        >
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!valid || pending.current) return;
              pending.current = true;
              setBusy(true);
              setError(undefined);
              try {
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
                setUrl("");
                void navigate(`/design/${result.designId}`);
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
            <Label htmlFor={urlId}>{t("home.figmaLink")}</Label>
            <Input
              id={urlId}
              type="url"
              value={url}
              placeholder={t("designEditor.import.figmaUrlPlaceholder")}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
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
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => changeOpen(false)}
              >
                {t("home.cancel")}
              </Button>
              <Button type="submit" disabled={!valid || busy}>
                {t("home.import")}
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </>
  );
}
