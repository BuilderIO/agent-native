import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { TemplatePreviewDialog } from "@agent-native/toolkit/app-shell";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { designTemplateRetryKey } from "@shared/design-template-retry";
import { IconDots } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { DesignTemplateGrid } from "./DesignTemplateGrid";
import { TemplatePreview } from "./TemplatePreview";

export interface DesignLibraryTemplate {
  id: string;
  title: string;
  description?: string | null;
  width?: number | null;
  height?: number | null;
  previewHtml?: string | null;
  isBuiltIn: boolean;
  isOwner?: boolean;
}

function previewFilenameForHref(
  href: string,
  currentFilename: string,
  files: readonly { filename: string }[],
): string | null {
  let target: URL;
  try {
    target = new URL(href, `https://design-preview.invalid/${currentFilename}`);
  } catch {
    // coercion-ok: malformed preview href is an absent local target.
    return null;
  }
  if (target.origin !== "https://design-preview.invalid") return null;
  let filename: string;
  try {
    filename = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  } catch {
    // coercion-ok: malformed encoded preview href is an absent local target.
    return null;
  }
  return (
    files.find((file) => file.filename.replace(/^\/+/, "") === filename)
      ?.filename ?? null
  );
}

export function DesignTemplateLibrary({
  templates,
  loading = false,
  previewParam = "templateId",
}: {
  templates: readonly DesignLibraryTemplate[];
  loading?: boolean;
  previewParam?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const create = useActionMutation("create-design-from-template");
  const remove = useActionMutation("delete-design-template");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = useRef(false);
  const retryIds = useRef(new Map<string, { key: string; id: string }>());
  const preview = templates.find(
    (template) => template.id === params.get(previewParam),
  );
  const [deleting, setDeleting] = useState<DesignLibraryTemplate | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const selectPreview = (id: string | null) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set(previewParam, id);
        else next.delete(previewParam);
        return next;
      },
      { replace: true },
    );
  };

  const copy = async (template: DesignLibraryTemplate) => {
    if (pending.current) return;
    pending.current = true;
    setPendingId(template.id);
    try {
      const retryKey = designTemplateRetryKey({
        templateId: template.id,
        title: template.title,
      });
      const previousRetry = retryIds.current.get(template.id);
      const newId =
        previousRetry?.key === retryKey ? previousRetry.id : nanoid();
      retryIds.current.set(template.id, { key: retryKey, id: newId });
      const result = await create.mutateAsync({
        templateId: template.id,
        title: template.title,
        newId,
        retryKey,
      });
      if (!result.id) throw new Error(t("templatesPage.createFailed"));
      const currentRetry = retryIds.current.get(template.id);
      if (currentRetry?.id === newId && currentRetry.key === retryKey) {
        retryIds.current.delete(template.id);
      }
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-designs"],
      });
      void navigate(`/design/${result.id}`);
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("templatesPage.createFailed"));
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  };
  const deleteSelected = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync({ id: deleting.id });
      setDeleting(null);
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-design-templates"],
      });
      toast.success(t("templatesPage.deleted"));
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("templatesPage.deleteFailed"));
    }
  };
  return (
    <>
      <DesignTemplateGrid
        templates={templates}
        loading={loading}
        pendingId={pendingId}
        pendingLabel={t("templatesPage.opening")}
        disabled={Boolean(pendingId)}
        selectedId={preview?.id}
        loadingLabel={t("templatesPage.loading")}
        emptyLabel={t("promptDialog.noTemplatesFound")}
        onSelect={(template, element) => {
          restoreFocusRef.current = element;
          selectPreview(template.id);
        }}
        renderActions={(template) =>
          !template.isBuiltIn && template.isOwner ? (
            <TemplateMenu
              template={template}
              disabled={pendingId !== null}
              onDelete={() => setDeleting(template)}
            />
          ) : null
        }
      />
      {preview ? (
        <DesignTemplatePreviewDialog
          key={preview.id}
          template={preview}
          restoreFocusRef={restoreFocusRef}
          onUseTemplate={() => void copy(preview)}
          useTemplatePending={pendingId === preview.id}
          useTemplateDisabled={pendingId !== null}
          onClose={() => selectPreview(null)}
        />
      ) : null}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("templatesPage.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("templatesPage.deleteDescription", {
                title: deleting?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteSelected()}>
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TemplateMenu({
  template,
  disabled,
  onDelete,
}: {
  template: DesignLibraryTemplate;
  disabled: boolean;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="secondary"
          size="icon-sm"
          disabled={disabled}
          aria-label={t("templatesPage.templateActions", {
            title: template.title,
          })}
        >
          <IconDots />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <ShareButton
            resourceType="design-template"
            resourceId={template.id}
            allowedRoles={["viewer", "editor", "admin"]}
            resourceTitle={template.title}
            trigger="label"
          />
          <DropdownMenuItem disabled={disabled} onSelect={onDelete}>
            {t("home.delete")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesignTemplatePreviewDialog({
  template,
  onClose,
  restoreFocusRef,
  onUseTemplate,
  useTemplatePending,
  useTemplateDisabled,
}: {
  template: DesignLibraryTemplate;
  onClose: () => void;
  restoreFocusRef: RefObject<HTMLElement | null>;
  onUseTemplate: () => void;
  useTemplatePending: boolean;
  useTemplateDisabled: boolean;
}) {
  const t = useT();
  const { data, isLoading, isError, refetch } = useActionQuery(
    "get-design-template",
    { templateId: template.id },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const files = useMemo(
    () =>
      data && "files" in data
        ? data.files.filter((file) => file.fileType === "html")
        : [],
    [data],
  );
  const active =
    files.find((file) => file.templateFileId === selectedId) ?? files[0];
  const activeId = active?.templateFileId;
  useEffect(() => {
    if (files.length < 2) return;
    const step = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return;
      const offset =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!offset) return;
      const index = files.findIndex((file) => file.templateFileId === activeId);
      const next = files[(index + offset + files.length) % files.length];
      if (!next) return;
      event.preventDefault();
      setSelectedId(next.templateFileId);
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [files, activeId]);
  return (
    <TemplatePreviewDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={template.title}
      restoreFocusRef={restoreFocusRef}
      onUseTemplate={onUseTemplate}
      useTemplatePending={useTemplatePending}
      useTemplateDisabled={useTemplateDisabled}
      loading={isLoading}
      error={isError ? t("common.genericError") : null}
      onRetry={() => void refetch()}
      empty={!isLoading && !isError && files.length === 0}
      labels={{
        close: t("designEditor.close"),
        useTemplate: t("templatesPage.useTemplate"),
        loading: t("templatesPage.loading"),
        empty: t("templatesPage.previewEmpty"),
        retry: t("homeContext.retry"),
        thumbnails: t("layersPanel.screens"),
      }}
      thumbnails={
        files.length > 1
          ? files.map((file) => ({
              id: file.templateFileId,
              title: file.filename,
              preview: (
                <TemplatePreview
                  html={file.content}
                  title={file.filename}
                  width={file.width}
                  height={file.height}
                />
              ),
            }))
          : []
      }
      selectedId={active?.templateFileId ?? ""}
      onSelectedIdChange={setSelectedId}
    >
      {active ? (
        <TemplatePreview
          key={active.templateFileId}
          html={active.content}
          title={active.filename}
          width={active.width}
          height={active.height}
          interactive
          recordSessionReplay
          onEscape={onClose}
          onNavigate={(href) => {
            const filename = previewFilenameForHref(
              href,
              active.filename,
              files,
            );
            const next = files.find((file) => file.filename === filename);
            if (next) setSelectedId(next.templateFileId);
          }}
        />
      ) : null}
    </TemplatePreviewDialog>
  );
}
