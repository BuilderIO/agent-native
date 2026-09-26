import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconUpload } from "@tabler/icons-react";
import { useId, useRef, useState } from "react";

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

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";
import {
  DECK_FILE_ACCEPT,
  type DeckFileKind,
  type usePromptImport,
} from "./use-prompt-import";

export function ImportDeckButton({
  controller,
}: {
  controller: ReturnType<typeof usePromptImport>;
}) {
  const t = useT();
  const urlId = useId();
  const input = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const openGoogleAfterMenu = useRef(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const scope = useRef<DeckFileKind | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [popover, setPopover] = useState<"google" | "error" | null>(null);
  const [url, setUrl] = useState("");
  const busy = controller.importingSource !== null;
  const openPicker = (kind?: DeckFileKind) => {
    if (!input.current || busy) return;
    scope.current = kind;
    input.current.accept = kind
      ? DECK_FILE_ACCEPT[kind]
      : Object.values(DECK_FILE_ACCEPT).join(",");
    input.current.value = "";
    controller.clear();
    setMenuOpen(false);
    setPopover(null);
    input.current.click();
  };
  return (
    <Popover
      open={popover !== null}
      onOpenChange={(open) => !open && !busy && setPopover(null)}
    >
      <PopoverAnchor asChild>
        <ButtonGroup aria-label={t("home.importMenu.import")}>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => openPicker()}
          >
            <IconUpload />
            {t(busy ? "editorToolbar.importing" : "home.importMenu.import")}
          </Button>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTrigger}
                type="button"
                size="sm"
                disabled={busy}
                aria-label={t("home.importMenu.options")}
              >
                <IconChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (!openGoogleAfterMenu.current) return;
                event.preventDefault();
                openGoogleAfterMenu.current = false;
                setPopover("google");
              }}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => openPicker("pdf")}>
                  PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    controller.clear();
                    openGoogleAfterMenu.current = true;
                  }}
                >
                  {t("home.googleSlidesReferenceTitle")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openPicker("pptx")}>
                  PPT
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </PopoverAnchor>
      <input
        ref={input}
        type="file"
        hidden
        disabled={busy}
        aria-label={t("editorToolbar.importFile")}
        accept={Object.values(DECK_FILE_ACCEPT).join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || busy) return;
          void controller.importFile(file, scope.current).then((done) => {
            if (!done) setPopover("error");
          });
        }}
      />
      <PopoverContent
        align="end"
        className="w-[min(28rem,calc(100vw-2rem))]"
        onOpenAutoFocus={(event) => {
          if (popover === "google") {
            event.preventDefault();
            urlInput.current?.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menuTrigger.current?.focus();
        }}
        aria-label={t(
          popover === "google"
            ? "home.googleSlidesReferenceTitle"
            : "home.importMenu.import",
        )}
      >
        {popover === "google" ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim() && !busy)
                void controller
                  .runImport({ kind: "google-slides", url: url.trim() })
                  .then((done) => {
                    if (done) setPopover(null);
                  });
            }}
          >
            <GoogleDriveConnectionCta />
            <Label htmlFor={urlId}>{t("home.googleSlidesReferenceUrl")}</Label>
            <Input
              ref={urlInput}
              id={urlId}
              type="url"
              required
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
            {controller.error && (
              <p role="alert" className="text-sm text-destructive">
                {controller.error}
              </p>
            )}
            <Button type="submit" disabled={busy || !url.trim()}>
              {t(busy ? "editorToolbar.importing" : "home.importMenu.import")}
            </Button>
          </form>
        ) : (
          <div className="grid gap-3">
            <p role="alert" className="text-sm text-destructive">
              {controller.error}
            </p>
            {controller.retrySelection && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (controller.retrySelection)
                    void controller
                      .runImport(controller.retrySelection)
                      .then((done) => {
                        if (done) setPopover(null);
                      });
                }}
              >
                {t(busy ? "editorToolbar.importing" : "home.retry")}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
