import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { IconChevronDown, IconLink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { AppEmbeddingSection } from "./AppEmbeddingSection";
import { projectShareLink } from "./project-share-model";

export function ProjectSharePopover({
  projectId,
  onClose,
  published = false,
  fromApp = false,
  title,
}: {
  projectId: string;
  onClose?: () => void;
  fromApp?: boolean;
  published?: boolean;
  title?: string;
}) {
  const t = useT();
  const [opener] = useState<HTMLElement | null>(() =>
    onClose !== undefined &&
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  const dismissedOutsideRef = useRef(false);
  const closedRef = useRef(false);
  useEffect(() => {
    if (onClose === undefined || typeof document === "undefined") return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-agent-native-share-overlay]") === null
      ) {
        dismissedOutsideRef.current = true;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissedOutsideRef.current = false;
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (closedRef.current && !dismissedOutsideRef.current && opener) {
        const restoreFocus = () => {
          if (!opener.isConnected) return;
          const active = document.activeElement;
          if (
            active === null ||
            active === document.body ||
            !active.isConnected
          ) {
            opener.focus();
          }
        };
        restoreFocus();
        queueMicrotask(restoreFocus);
      }
    };
  }, [onClose, opener]);
  const shareUrl =
    typeof window === "undefined"
      ? undefined
      : projectShareLink(window.location.origin, projectId, appBasePath());
  return (
    <ShareButton
      mobileSheet
      defaultOpen={onClose !== undefined}
      hideTrigger={onClose !== undefined}
      autoFocusInvite
      stagedInvites
      onLinkCopied={() => toast.success(t("projectSharing.linkCopied"))}
      allowedRoles={["viewer", "editor", "admin"]}
      invitePlaceholder={t("projectSharing.invitePlaceholder")}
      {...(title
        ? { panelTitle: t("publishedAppSharing.title", { project: title }) }
        : {})}
      visibilityCopy={{
        private: { label: t("publishedAppSharing.inviteOnly") },
      }}
      roleCopy={{
        viewer: {
          label: t("publishedAppSharing.roles.explorer"),
          description: t("projectSharing.roleDescriptions.explorer"),
        },
        editor: {
          label: t("publishedAppSharing.roles.editor"),
          description: t("projectSharing.roleDescriptions.editor"),
        },
        admin: {
          label: t("publishedAppSharing.roles.manager"),
          description: t("publishedAppSharing.descriptions.manager"),
        },
      }}
      onOpenChange={(open) => {
        if (!open) {
          closedRef.current = true;
          onClose?.();
        }
      }}
      resourceType="analytics-project"
      resourceId={projectId}
      shareFooterContent={
        <AppEmbeddingSection projectId={projectId} publishedHint={published} />
      }
      {...(published
        ? {
            shareUrlPlaceholder: (
              <ProjectCopyLink projectId={projectId} fromApp={fromApp} />
            ),
          }
        : shareUrl === undefined
          ? {}
          : { shareUrl })}
    />
  );
}

export function ProjectCopyLink({
  projectId,
  fromApp = false,
  appHref,
}: {
  projectId: string;
  fromApp?: boolean;
  appHref?: string;
}) {
  const t = useT();
  const [manualLink, setManualLink] = useState<string | null>(null);
  async function copy(app: boolean) {
    const origin = window.location.origin;
    const url = app
      ? new URL(
          appHref ?? appPath(`/app/${encodeURIComponent(projectId)}/latest`),
          origin,
        ).href
      : projectShareLink(origin, projectId, appBasePath());
    if (await writeClipboardText(url)) {
      setManualLink(null);
      toast.success(
        t(app ? "notebook.appLinkCopied" : "notebook.projectLinkCopied"),
      );
    } else {
      setManualLink(url);
      toast.error(t("publishedAppSharing.copyFailed"));
    }
  }
  return (
    <>
      <span className="inline-flex items-center gap-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-r-none max-[390px]:h-11"
          onClick={() => void copy(fromApp)}
        >
          <IconLink size={14} aria-hidden="true" />
          {t("notebook.copyLink")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-l-none border-l-0 max-[390px]:size-11"
              aria-label={t("notebook.copyLinkOptions")}
            >
              <IconChevronDown size={14} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void copy(false)}>
              {t("notebook.copyProjectLink")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copy(true)}>
              {t("notebook.copyAppLink")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      {manualLink ? (
        <Input
          className="w-full"
          value={manualLink}
          readOnly
          aria-label={t("publishedAppSharing.copiedLink")}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </>
  );
}
