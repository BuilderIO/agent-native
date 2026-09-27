import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Skeleton } from "../ui/skeleton.js";
import {
  useComposerContextPicker,
  type ComposerContextPickerConfig,
} from "./useComposerContextPicker.js";

export function ComposerContextPickerDialog({
  config,
  title,
  onClose,
  onRestoreFocus,
}: {
  config: ComposerContextPickerConfig;
  title: string;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const picker = useComposerContextPicker({ config, onClose });
  const { t, stage, link, selecting, loading, items, location } = picker;
  const presentation =
    typeof config.presentation === "object" ? config.presentation : undefined;
  const urlOnly = presentation?.mode === "url";
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    input.current?.focus();
  }, [stage]);
  const validation = touched && link.trim() ? picker.linkError : undefined;
  const error = stage === "link" ? picker.actionError?.message : picker.error;
  const attach = t("agentChat.composer.contextAttach", {
    defaultValue: "Attach",
  });
  const canAttach =
    picker.selectedItems.length > 0 && !loading && !selecting && !error;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        overlayClassName="bg-background/85 backdrop-blur-sm"
        closeLabel={t("agentChat.common.close", { defaultValue: "Close" })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (selecting) return;
            if (stage === "link") picker.submitLink();
            else if (canAttach) void picker.select("batch");
          }}
        >
          {stage === "link" ? (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-url`}>
                {config.link?.label ??
                  t("agentChat.composer.contextUrlLabel", {
                    defaultValue: "URL",
                  })}
              </Label>
              <Input
                ref={input}
                id={`${id}-url`}
                type="url"
                value={link}
                placeholder={config.link?.placeholder}
                aria-invalid={Boolean(validation)}
                aria-describedby={validation ? `${id}-validation` : undefined}
                disabled={selecting}
                onBlur={() => setTouched(true)}
                onChange={(event) => {
                  picker.setLink(event.target.value);
                  picker.setActionError(undefined);
                }}
              />
              {validation && (
                <p id={`${id}-validation`} className="text-sm text-destructive">
                  {validation}
                </p>
              )}
            </div>
          ) : (
            <>
              <Input
                ref={input}
                type="search"
                aria-label={config.searchPlaceholder}
                placeholder={config.searchPlaceholder}
                value={location.search}
                onChange={(event) => {
                  picker.cursors.current = [undefined];
                  picker.move({
                    search: event.target.value,
                    page: 1,
                    url: location.url,
                  });
                }}
              />
              {error ? null : loading ? (
                <div
                  className="grid gap-2"
                  role="status"
                  aria-label={t("agentChat.composer.contextPending", {
                    defaultValue: "Loading context…",
                  })}
                >
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : items.length ? (
                <div className="grid max-h-64 gap-3 overflow-y-auto">
                  {items.map((item) => {
                    const attached =
                      config.selectedIds?.includes(item.id) === true;
                    return (
                      <div key={item.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`${id}-${item.id}`}
                          checked={
                            attached ||
                            picker.selectedItems.some(
                              (selected) => selected.id === item.id,
                            )
                          }
                          disabled={attached || item.disabled || selecting}
                          onCheckedChange={(checked) =>
                            picker.toggleItem(item, checked === true)
                          }
                        />
                        <Label htmlFor={`${id}-${item.id}`}>{item.title}</Label>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  {config.emptyMessage ??
                    t("agentChat.composer.noContextResults", {
                      defaultValue: "No matching context.",
                    })}
                </p>
              )}
              {(location.page > 1 || picker.hasMore) && (
                <div className="flex gap-2">
                  {location.page > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading || selecting}
                      onClick={() =>
                        picker.move({
                          ...location,
                          page: location.page - 1,
                          cursor: picker.cursors.current[location.page - 2],
                        })
                      }
                    >
                      {t("agentChat.composer.contextPrevious", {
                        defaultValue: "Previous",
                      })}
                    </Button>
                  )}
                  {picker.hasMore && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading || selecting || Boolean(error)}
                      onClick={() => {
                        picker.cursors.current = [
                          ...picker.cursors.current.slice(0, location.page),
                          picker.result?.nextCursor,
                        ];
                        picker.move({
                          ...location,
                          page: location.page + 1,
                          cursor: picker.result?.nextCursor,
                        });
                      }}
                    >
                      {t("agentChat.composer.contextNext", {
                        defaultValue: "Next",
                      })}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            {error &&
              (stage === "link" ? picker.actionError?.retry : picker.retry) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={selecting || (stage === "results" && loading)}
                  onClick={() => {
                    if (stage === "link") picker.actionError?.retry?.();
                    else picker.retry?.();
                  }}
                >
                  {t("agentChat.common.retry", { defaultValue: "Retry" })}
                </Button>
              )}
            {stage === "results" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTouched(false);
                  picker.back();
                }}
              >
                {t("agentChat.composer.contextBack", { defaultValue: "Back" })}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              {t("agentChat.common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="submit"
              disabled={
                stage === "link"
                  ? selecting || Boolean(picker.linkError)
                  : !canAttach
              }
            >
              {stage === "link" && !urlOnly
                ? t("agentChat.common.continue", { defaultValue: "Continue" })
                : attach}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
