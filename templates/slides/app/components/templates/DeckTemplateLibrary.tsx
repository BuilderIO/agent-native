import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { LazyChunkErrorBoundary } from "@agent-native/core/client/lazy-chunk-error-boundary";
import { LazyChunkRetryFallback } from "@agent-native/core/client/lazy-chunk-retry-fallback";
import {
  TemplateLibraryGrid,
  TemplatePreviewDialog,
} from "@agent-native/toolkit/app-shell";
import { IconDots, IconEye } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { lazy, Suspense, useRef, useState, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import { DeckTemplatePreview } from "./DeckTemplatePreview";
import { DeckTemplateStage } from "./DeckTemplateStage";

const LazySlideRenderer = lazy(() => import("@/components/deck/SlideRenderer"));

export function DeckTemplateLibrary({
  home = false,
  search = "",
}: {
  home?: boolean;
  search?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("templateId");
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const query = useActionQuery("list-deck-templates", {
    page: 1,
    pageSize: home ? 4 : 6,
    includePreview: "true",
    search: search.trim() || undefined,
  });
  const create = useActionMutation("create-deck-from-template");
  const retryIds = useRef(new Map<string, string>());
  const pending = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("templateId", id);
    else next.delete("templateId");
    setParams(next, { replace: true });
  };

  const copyTemplate = async (id: string) => {
    if (pending.current) return;
    pending.current = true;
    setPendingId(id);
    setCopyError(null);
    const newId = retryIds.current.get(id) ?? nanoid();
    retryIds.current.set(id, newId);
    try {
      const result = await create.mutateAsync({ templateId: id, newId });
      if (!result.id) throw new Error(t("templatesPage.createFailed"));
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-decks"],
      });
      await navigate(`/deck/${encodeURIComponent(result.id)}`);
    } catch (cause) {
      setCopyError({
        id,
        message: actionErrorMessage(cause) ?? t("templatesPage.createFailed"),
      });
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  };

  return (
    <>
      {pendingId ? (
        <div role="status" className="flex items-center gap-2">
          <Spinner />
          {t("templatesPage.opening")}
        </div>
      ) : null}
      <TemplateLibraryGrid
        items={query.data?.templates ?? []}
        selectedId={selectedId}
        pendingId={pendingId}
        disabled={pendingId !== null}
        loading={query.isLoading || pendingId !== null}
        error={
          copyError?.message ??
          (query.isError
            ? (actionErrorMessage(query.error) ?? t("templatesPage.loadFailed"))
            : null)
        }
        onRetry={() => {
          if (copyError) void copyTemplate(copyError.id);
          else void query.refetch();
        }}
        labels={{
          loading: t("templatesPage.loading"),
          empty: t("templatesPage.empty"),
          retry: t("home.retry"),
        }}
        onSelect={(template) => void copyTemplate(template.id)}
        renderPreview={(template) =>
          template.previewHtml ? (
            <DeckTemplatePreview
              html={template.previewHtml}
              title={template.title}
            />
          ) : null
        }
        renderActions={(template) => (
          <TemplateActions
            title={template.title}
            disabled={pendingId !== null}
            onPreview={(trigger) => {
              previewTriggerRef.current = trigger;
              select(template.id);
            }}
          />
        )}
      />
      {selectedId ? (
        <DeckTemplateDialog
          key={selectedId}
          id={selectedId}
          onClose={() => select(null)}
          restoreFocusRef={previewTriggerRef}
        />
      ) : null}
    </>
  );
}

function TemplateActions({
  title,
  disabled,
  onPreview,
}: {
  title: string;
  disabled: boolean;
  onPreview: (trigger: HTMLElement | null) => void;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const openingPreview = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t("templatesPage.actions", { title })}
        >
          <IconDots />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (openingPreview.current) {
            event.preventDefault();
            openingPreview.current = false;
          }
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              openingPreview.current = true;
              onPreview(trigger.current);
            }}
          >
            <IconEye size={16} />
            {t("templatesPage.previewAction")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeckTemplateDialog({
  id,
  onClose,
  restoreFocusRef,
}: {
  id: string;
  onClose: () => void;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const query = useActionQuery("get-deck-template", { id });
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const slides = Array.isArray(query.data?.slides) ? query.data.slides : [];
  const slide = slides.find((item) => item.id === selectedSlideId) ?? slides[0];
  const validTemplate =
    slides.length > 0 &&
    slides.every(
      (item) =>
        typeof item.content === "string" && item.content.trim().length > 0,
    );
  return (
    <TemplatePreviewDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={query.data?.title ?? t("templatesPage.preview")}
      restoreFocusRef={restoreFocusRef}
      loading={query.isLoading}
      error={
        !query.isLoading && (query.isError || !validTemplate)
          ? (actionErrorMessage(query.error) ?? t("templatesPage.loadFailed"))
          : null
      }
      onRetry={() => void query.refetch()}
      labels={{
        close: t("comments.close"),
        loading: t("templatesPage.loading"),
        empty: t("templatesPage.empty"),
        retry: t("home.retry"),
        thumbnails: t("header.slides"),
      }}
      thumbnails={
        validTemplate
          ? slides.map((item, index) => ({
              id: item.id,
              title: t("templatesPage.slidePosition", {
                current: index + 1,
                total: slides.length,
              }),
              preview: (
                <DeckTemplatePreview
                  html={item.content}
                  title={query.data!.title}
                />
              ),
            }))
          : []
      }
      selectedId={slide?.id ?? ""}
      onSelectedIdChange={setSelectedSlideId}
    >
      {slide ? (
        <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <DeckTemplateStage>
              <LazySlideRenderer
                slide={slide}
                aspectRatio="16:9"
                thumbnail={false}
              />
            </DeckTemplateStage>
          </Suspense>
        </LazyChunkErrorBoundary>
      ) : null}
    </TemplatePreviewDialog>
  );
}
