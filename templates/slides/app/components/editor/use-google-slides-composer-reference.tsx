import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { ComposerContextMenuItem } from "@agent-native/toolkit/composer";
import { parseGoogleSlidesReferenceUrl } from "@shared/google-docs";
import { IconBrandGoogle } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readGoogleSlidesContext } from "@/lib/google-slides-context";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";

export function useGoogleSlidesComposerReference({
  active,
  isCurrent,
  scopeKey,
  onAttach,
}: {
  active: boolean;
  isCurrent: () => boolean;
  scopeKey: string;
  onAttach: (reference: {
    id: string;
    title: string;
    url: string;
  }) => boolean | void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const openRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const scope = useRef(scopeKey);
  const validationId = useId();
  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    request.current?.abort();
    request.current = null;
    setPending(false);
  }, []);
  useEffect(() => {
    if (scope.current === scopeKey) return;
    scope.current = scopeKey;
    close();
    setUrl("");
    setError(undefined);
  }, [scopeKey, close]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  const reference = parseGoogleSlidesReferenceUrl(url);
  const label = t("home.googleSlidesReferenceTitle");
  const attach = async () => {
    if (!reference || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const result = await readGoogleSlidesContext(
        reference.url,
        t("home.context.googleSlides.failed"),
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        request.current !== controller ||
        !isCurrent() ||
        !openRef.current ||
        scope.current !== scopeKey
      )
        return;
      if (
        onAttach({
          id: result.id,
          title: result.title || label,
          url: result.url,
        }) === false
      ) {
        setError(t("home.context.saveFailed"));
        return;
      }
      close();
    } catch (cause) {
      if (
        controller.signal.aborted ||
        request.current !== controller ||
        !isCurrent() ||
        scope.current !== scopeKey
      )
        return;
      setError(
        actionErrorMessage(cause) ?? t("home.context.googleSlides.failed"),
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };
  const menuItem: ComposerContextMenuItem = {
    id: "google-slides",
    label,
    order: 10,
    section: "context",
    icon: <IconBrandGoogle />,
    opensDialog: true,
    onSelect: () => {
      const focused = document.activeElement;
      const menu =
        focused instanceof HTMLElement
          ? focused.closest('[role="menu"]')
          : null;
      const triggerId = menu?.getAttribute("aria-labelledby");
      opener.current = triggerId
        ? document.getElementById(triggerId)
        : focused instanceof HTMLElement
          ? focused
          : null;
      setUrl("");
      setError(undefined);
      openRef.current = true;
      setOpen(true);
    },
  };
  return {
    menuItem,
    dialog: (
      <Dialog
        open={active && open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent
          closeLabel={t("comments.close")}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (isCurrent() && opener.current?.isConnected)
              opener.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              void attach();
            }}
          >
            <GoogleDriveConnectionCta active={active && open} />
            <Input
              ref={input}
              type="url"
              value={url}
              disabled={pending}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(undefined);
              }}
              placeholder={t("home.googleSlidesReferenceUrl")}
              aria-label={t("home.googleSlidesReferenceUrl")}
              aria-invalid={Boolean(url.trim() && !reference)}
              aria-describedby={
                url.trim() && !reference ? validationId : undefined
              }
            />
            {url.trim() && !reference && (
              <p
                id={validationId}
                role="alert"
                className="text-sm text-destructive"
              >
                {t("home.context.googleSlides.invalid")}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("home.cancel")}
              </Button>
              <Button type="submit" disabled={!reference || pending}>
                {t(
                  pending
                    ? "home.context.googleSlides.reading"
                    : "home.context.googleSlides.attach",
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    ),
  };
}
