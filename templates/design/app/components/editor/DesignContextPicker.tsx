import { useDesignSystemWorkspaceOrigin } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ComposerContextSearchInput,
  type ComposerContextPageControls,
} from "@agent-native/toolkit/composer";
import { parseFigmaUrl } from "@shared/figma-url";
import { IconCheck, IconPlus } from "@tabler/icons-react";
import { lazy, Suspense, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { referenceFromContextItem } from "@/lib/composer-context";

import type { DesignPromptContextController } from "./use-design-prompt-context";

const DesignSystemSetup = lazy(() => import("@/pages/DesignSystemSetup"));

export function DesignContextPage({
  page: sourcePage,
  controller,
  controls,
  initialSearch = "",
  onSearchChange,
}: {
  page: "systems" | "design" | "slides" | "figma";
  controller: DesignPromptContextController;
  controls: ComposerContextPageControls;
  initialSearch?: string;
  onSearchChange?: (value: string) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState(initialSearch);
  const [figmaUrl, setFigmaUrl] = useState("");
  const [loadedFigmaUrl, setLoadedFigmaUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlErrorId = useId();
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const source = sourcePage === "systems" ? null : sourcePage;
  const systems = useActionQuery<{
    designSystems: { id: string; title: string }[];
  }>(
    "list-design-systems",
    { compact: "true" },
    { enabled: sourcePage === "systems" },
  );
  const sources = useActionQuery<{
    items: { id: string; title: string; url?: string }[];
    hasMore?: boolean;
    nextCursor?: string;
  }>(
    "read-composer-source",
    {
      source,
      operation: "list",
      search,
      page,
      cursor: cursors[page - 1],
      ...(source === "figma" ? { figmaUrl: loadedFigmaUrl } : {}),
    },
    {
      enabled:
        Boolean(source) && (source !== "figma" || Boolean(loadedFigmaUrl)),
    },
  );
  const back = () => {
    if (loadedFigmaUrl) setLoadedFigmaUrl("");
    else controls.onBack();
  };
  const browseFrames = () => {
    if (
      !/^https?:\/\//i.test(figmaUrl.trim()) ||
      !parseFigmaUrl(figmaUrl).fileKey
    ) {
      setUrlError(t("composerContext.invalidFigmaUrl"));
      return;
    }
    setUrlError(null);
    setSearch("");
    setPage(1);
    setCursors([undefined]);
    setLoadedFigmaUrl(figmaUrl.trim());
  };

  if (source === "figma" && !loadedFigmaUrl) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          browseFrames();
        }}
      >
        <Command shouldFilter={false} label={t("composerContext.attachFigma")}>
          <ComposerContextSearchInput
            autoFocus
            onBack={back}
            value={figmaUrl}
            onValueChange={(value) => {
              setFigmaUrl(value);
              setUrlError(null);
            }}
            aria-label={t("composerContext.figmaUrl")}
            placeholder={t("composerContext.figmaUrl")}
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? urlErrorId : undefined}
          />
          <CommandList>
            {urlError ? (
              <p
                id={urlErrorId}
                role="alert"
                className="p-3 text-sm text-destructive"
              >
                {urlError}
              </p>
            ) : null}
            <CommandGroup>
              <CommandItem value="browse-frames" onSelect={browseFrames}>
                {t("composerContext.browseFrames")}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </form>
    );
  }

  const query = source ? sources : systems;
  const isLoading = source ? sources.isFetching : systems.isLoading;
  const title = t(
    sourcePage === "systems"
      ? "composerContext.useSystem"
      : sourcePage === "design"
        ? "composerContext.referenceDesign"
        : sourcePage === "slides"
          ? "composerContext.referenceDeck"
          : "composerContext.browseFrames",
  );
  return (
    <Command shouldFilter={sourcePage === "systems"} label={title}>
      <ComposerContextSearchInput
        autoFocus
        onBack={back}
        value={search}
        onValueChange={(value) => {
          setSearch(value);
          onSearchChange?.(value);
          setPage(1);
          setCursors([undefined]);
        }}
        aria-label={title}
        placeholder={t("composerContext.search")}
      />
      <CommandList>
        {query.error ? (
          <>
            <div role="alert" className="p-3 text-sm text-destructive">
              {actionErrorMessage(query.error) ??
                t("composerContext.unavailable")}
            </div>
            <CommandGroup forceMount>
              <CommandItem
                value="retry"
                forceMount
                onSelect={() => void query.refetch()}
              >
                {t("composerContext.retry")}
              </CommandItem>
            </CommandGroup>
          </>
        ) : isLoading ? (
          <div
            className="grid gap-2 p-2"
            role="status"
            aria-label={t("composerContext.resolving")}
          >
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <>
            <CommandEmpty>{t("composerContext.noResults")}</CommandEmpty>
            <CommandGroup>
              {sourcePage === "systems" ? (
                <>
                  <CommandItem
                    value="no-system"
                    keywords={[t("promptDialog.noDesignSystem")]}
                    onSelect={() => {
                      controller.changeSystem(null);
                      controls.onClose();
                    }}
                  >
                    <span className="flex-1 truncate">
                      {t("promptDialog.noDesignSystem")}
                    </span>
                    {!controller.selectedSystemId ? (
                      <IconCheck className="ms-2 size-4 shrink-0" aria-hidden />
                    ) : null}
                  </CommandItem>
                  {(systems.data?.designSystems ?? []).map((system) => (
                    <CommandItem
                      key={system.id}
                      value={system.id}
                      keywords={[system.title]}
                      onSelect={() => {
                        controller.changeSystem(system.id);
                        controls.onClose();
                      }}
                    >
                      <span className="flex-1 truncate">{system.title}</span>
                      {controller.selectedSystemId === system.id ? (
                        <IconCheck
                          className="ms-2 size-4 shrink-0"
                          aria-hidden
                        />
                      ) : null}
                    </CommandItem>
                  ))}
                </>
              ) : (
                (sources.data?.items ?? []).map((item) => {
                  const selected = controller.contextItems.some((context) => {
                    const ref = referenceFromContextItem(context);
                    return (
                      ref?.source === source &&
                      ref.id === item.id &&
                      (source !== "figma" ||
                        ref.url === (item.url ?? loadedFigmaUrl))
                    );
                  });
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        if (!selected)
                          controller.selectSource({
                            source: source!,
                            id: item.id,
                            title: item.title,
                            ...(item.url || source === "figma"
                              ? { url: item.url ?? loadedFigmaUrl }
                              : {}),
                          });
                        controls.onClose();
                      }}
                    >
                      <span className="flex-1 truncate">{item.title}</span>
                      {selected ? (
                        <IconCheck
                          className="ms-2 size-4 shrink-0"
                          aria-hidden
                        />
                      ) : null}
                    </CommandItem>
                  );
                })
              )}
            </CommandGroup>
          </>
        )}
        {sourcePage === "systems" ? (
          <>
            <CommandSeparator />
            <CommandGroup forceMount>
              <CommandItem
                value="create-system"
                forceMount
                keywords={[t("promptDialog.createDesignSystem")]}
                onSelect={() =>
                  controller.createSystem({
                    ...controls,
                    onClose: () => controls.onClose({ restoreFocus: false }),
                  })
                }
              >
                <IconPlus className="me-2 size-4 shrink-0" />
                {t("promptDialog.createDesignSystem")}
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
      {source && (page > 1 || sources.data?.hasMore) ? (
        <div className="flex justify-between gap-2 border-t p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page === 1 || sources.isFetching}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("home.paginationPrevious")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!sources.data?.hasMore || sources.isFetching}
            onClick={() => {
              setCursors((values) => [
                ...values.slice(0, page),
                sources.data?.nextCursor,
              ]);
              setPage((value) => value + 1);
            }}
          >
            {t("home.paginationNext")}
          </Button>
        </div>
      ) : null}
    </Command>
  );
}

export function DesignContextPicker({
  controller,
}: {
  controller: DesignPromptContextController;
  selectedSystemId?: string | null;
  onSystemChange?: (id: string | null) => void | Promise<void>;
}) {
  const t = useT();
  const openWorkspace = useDesignSystemWorkspaceOrigin(
    controller.draftId,
    async (system) => {
      controller.changeSystem(system.id, {
        id: system.id,
        ownerApp: system.ownerApp,
        consumedRevision: system.revision,
      });
      await controller.flush();
    },
  );
  const { view, setView } = controller;
  const [creationAttempt, setCreationAttempt] = useState(0);
  const returnToPicker = () => controller.resumePicker();
  return (
    <>
      <Suspense fallback={null}>
        <DesignSystemSetup
          key={`${controller.draftId}:${creationAttempt}`}
          open={view === "create"}
          originDraft={{
            app: "design",
            draftId: controller.draftId,
            returnPath: `${window.location.pathname}${window.location.search}`,
          }}
          onReturnToPrompt={returnToPicker}
          onContinueInChat={() => setView(null)}
          onCreated={(systemId) => {
            setView(null);
            setCreationAttempt((attempt) => attempt + 1);
            openWorkspace(systemId);
          }}
        />
      </Suspense>
      <Dialog
        open={view === "inspect"}
        onOpenChange={(open) => {
          if (!open) setView(null);
        }}
      >
        <DialogContent
          data-design-context-picker
          className="sm:max-w-lg"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {controller.inspected?.title ?? t("composerContext.inspect")}
            </DialogTitle>
          </DialogHeader>
          {view === "inspect" && controller.inspected ? (
            <>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">
                {controller.inspected.statusMessage ??
                  controller.inspected.context}
              </pre>
              <div className="flex justify-end gap-2">
                {controller.inspected.key === "design-system" &&
                (!controller.systemReference ||
                  controller.systemReference.ownerApp === "design") &&
                controller.selectedSystemId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setView(null);
                      openWorkspace(controller.selectedSystemId!);
                    }}
                  >
                    {t("systemWorkspace.canvas")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    controller.onRemoveContextItem(controller.inspected!.key);
                    setView(null);
                  }}
                >
                  {t("composerContext.remove")}
                </Button>
                {controller.inspected.status === "error" ? (
                  <Button
                    type="button"
                    onClick={() => {
                      void controller.onRetryContextItem(
                        controller.inspected!.key,
                      );
                      setView(null);
                    }}
                  >
                    {t("composerContext.retry")}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
