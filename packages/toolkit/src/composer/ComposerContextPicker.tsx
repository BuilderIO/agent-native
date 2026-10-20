import { IconArrowLeft, IconCheck } from "@tabler/icons-react";

import { Button } from "../ui/button.js";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu.js";
import { Skeleton } from "../ui/skeleton.js";
import { ComposerContextMenuSearch } from "./ComposerContextMenuSearch.js";
import {
  useComposerContextPicker,
  type ComposerContextPickerConfig,
} from "./useComposerContextPicker.js";
export type {
  ComposerContextPickerConfig,
  ComposerContextPickerItem,
  ComposerContextPickerRequest,
  ComposerContextPickerResult,
  ComposerContextPickerSelection,
  ComposerContextPickerFooterAction,
} from "./useComposerContextPicker.js";

export function ComposerContextPicker({
  config,
  onClose,
}: {
  config: ComposerContextPickerConfig;
  onClose: () => void;
}) {
  const {
    t,
    stage,
    link,
    setLink,
    location,
    cursors,
    move,
    back,
    select,
    submitLink,
    loading,
    error,
    items,
    hasMore,
    retry,
    selecting,
    actionError,
    setActionError,
    result,
  } = useComposerContextPicker({ config, onClose });
  const check = (selected: boolean) => (
    <span className="ms-auto size-4 shrink-0" aria-hidden="true">
      {selected ? <IconCheck className="size-4" /> : null}
    </span>
  );

  const footer = config.footerAction;
  const footerContent = footer ? (
    <>
      {footer.icon}
      {footer.label}
    </>
  ) : null;
  return (
    <>
      <ComposerContextMenuSearch
        leading={
          stage === "results" && config.link ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("agentChat.composer.contextBack", {
                defaultValue: "Back",
              })}
              onClick={back}
            >
              <IconArrowLeft size={16} />
            </Button>
          ) : undefined
        }
        placeholder={
          stage === "link" ? config.link!.placeholder : config.searchPlaceholder
        }
        invalid={stage === "link" && Boolean(actionError)}
        value={stage === "link" ? link : location.search}
        onValueChange={(value) => {
          if (stage === "link") {
            setLink(value);
            setActionError(undefined);
          } else {
            cursors.current = [undefined];
            move({ search: value, page: 1, url: location.url });
          }
        }}
        onSubmit={stage === "link" ? submitLink : undefined}
      />
      <DropdownMenuGroup
        className="max-h-64 overflow-y-auto"
        aria-busy={stage === "results" && (loading || selecting)}
      >
        {stage === "link" ? (
          <>
            {actionError && (
              <>
                <div role="alert" className="p-3 text-sm text-destructive">
                  {actionError.message}
                </div>
                {actionError.retry && (
                  <DropdownMenuItem
                    disabled={selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      actionError.retry?.();
                    }}
                  >
                    {t("agentChat.common.retry", { defaultValue: "Retry" })}
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                submitLink();
              }}
            >
              {config.link!.submitLabel}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {error ? (
              <>
                <div role="alert" className="p-3 text-sm text-destructive">
                  {error}
                </div>
                {retry && (
                  <DropdownMenuItem
                    disabled={loading || selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      retry();
                    }}
                  >
                    {t("agentChat.common.retry", { defaultValue: "Retry" })}
                  </DropdownMenuItem>
                )}
              </>
            ) : loading ? (
              <div
                role="status"
                aria-label={t("agentChat.composer.contextPending", {
                  defaultValue: "Loading context…",
                })}
                className="grid gap-1 p-1"
              >
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                {!items.length && (
                  <div
                    role="status"
                    className="p-3 text-xs text-muted-foreground"
                  >
                    {config.emptyMessage ??
                      t("agentChat.composer.noContextResults", {
                        defaultValue: "No matching context.",
                      })}
                  </div>
                )}
                {config.clearSelection && (
                  <DropdownMenuItem
                    role="menuitemcheckbox"
                    aria-checked={!config.selectedIds?.length}
                    disabled={selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      void select();
                    }}
                  >
                    {config.clearSelection.label}
                    {check(!config.selectedIds?.length)}
                  </DropdownMenuItem>
                )}
                {items.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    role="menuitemcheckbox"
                    aria-checked={
                      config.selectedIds?.includes(item.id) === true
                    }
                    disabled={item.disabled || selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      void select(item);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    {check(config.selectedIds?.includes(item.id) === true)}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {(location.page > 1 || hasMore) && (
              <>
                {location.page > 1 && (
                  <DropdownMenuItem
                    disabled={loading || selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      move({
                        ...location,
                        page: location.page - 1,
                        cursor: cursors.current[location.page - 2],
                      });
                    }}
                  >
                    {t("agentChat.composer.contextPrevious", {
                      defaultValue: "Previous",
                    })}
                  </DropdownMenuItem>
                )}
                {hasMore && (
                  <DropdownMenuItem
                    disabled={loading || selecting || Boolean(error)}
                    onSelect={(event) => {
                      event.preventDefault();
                      cursors.current = [
                        ...cursors.current.slice(0, location.page),
                        result?.nextCursor,
                      ];
                      move({
                        ...location,
                        page: location.page + 1,
                        cursor: result?.nextCursor,
                      });
                    }}
                  >
                    {t("agentChat.composer.contextNext", {
                      defaultValue: "Next",
                    })}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </>
        )}
      </DropdownMenuGroup>
      {footer && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {footer.renderLink && !footer.disabled && !selecting ? (
              <DropdownMenuItem asChild onSelect={onClose}>
                {footer.renderLink(footerContent)}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={footer.disabled || selecting}
                onSelect={(event) => {
                  event.preventDefault();
                  void select("footer");
                }}
              >
                {footerContent}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}
