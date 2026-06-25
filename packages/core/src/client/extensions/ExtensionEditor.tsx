import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconDots,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";

import { extensionPath } from "../../extensions/path.js";
import { agentNativePath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { cn } from "../utils.js";
import {
  deleteOrHideExtension,
  invalidateExtensionRemoval,
} from "./delete-extension.js";

interface SlotDeclaration {
  id: string;
  extensionId: string;
  slotId: string;
}

interface Extension {
  id: string;
  name: string;
  description?: string;
  content?: string;
  canDelete?: boolean;
}

export interface ExtensionEditorProps {
  extensionId?: string;
}

export function ExtensionEditor({ extensionId }: ExtensionEditorProps) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!extensionId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: slots = [] } = useQuery<SlotDeclaration[]>({
    queryKey: ["extension-slots", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/slots/extension/${extensionId}`),
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isEdit && menuOpen,
  });

  const { data: existingTool } = useQuery<Extension>({
    queryKey: ["extension", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/extensions/${extensionId}`),
      );
      if (!res.ok) throw new Error("Failed to fetch extension");
      return res.json();
    },
    enabled: isEdit,
  });

  useEffect(() => {
    if (existingTool) {
      setName(existingTool.name ?? "");
      setDescription(existingTool.description ?? "");
      setContent(existingTool.content ?? "");
    }
  }, [existingTool]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        content,
      });

      if (isEdit) {
        const res = await fetch(
          agentNativePath(`/_agent-native/extensions/${extensionId}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
          },
        );
        if (!res.ok) throw new Error("Update failed");
        queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        navigate(extensionPath(extensionId, name.trim()));
      } else {
        const res = await fetch(agentNativePath("/_agent-native/extensions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) throw new Error("Create failed");
        const created = await res.json();
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        navigate(extensionPath(created.id, created.name ?? name.trim()));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!extensionId) return;
    setDeleting(true);
    const prev = queryClient.getQueryData<Extension[]>(["extensions"]);
    try {
      queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
        (old ?? []).filter((t) => t.id !== extensionId),
      );

      await deleteOrHideExtension({
        id: extensionId,
        canDelete: existingTool?.canDelete,
      });
      invalidateExtensionRemoval(queryClient, extensionId);
      slots.forEach((s) =>
        queryClient.invalidateQueries({
          queryKey: ["slot-installs", s.slotId],
        }),
      );
      navigate("/extensions");
    } catch {
      if (prev) queryClient.setQueryData(["extensions"], prev);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
      setMenuOpen(false);
    }
  };

  const handleRemoveFromSlot = async (slotId: string) => {
    if (!extensionId) return;
    try {
      await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/install/${encodeURIComponent(extensionId)}`,
        ),
        { method: "DELETE" },
      );
    } finally {
      queryClient.invalidateQueries({ queryKey: ["slot-installs", slotId] });
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              to={
                extensionId
                  ? extensionPath(extensionId, existingTool?.name ?? name)
                  : "/extensions"
              }
              className="inline-flex cursor-pointer items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label={t("extensions.back")}
            >
              <IconArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-sm font-semibold">
              {isEdit
                ? t("extensions.editExtension")
                : t("extensions.newExtension")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className={cn(
                "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90",
                (saving || !name.trim()) && "opacity-60",
              )}
            >
              <IconDeviceFloppy className="h-3.5 w-3.5" />
              {saving
                ? t("extensions.saving")
                : isEdit
                  ? t("extensions.save")
                  : t("extensions.create")}
            </button>
            {isEdit && (
              <Popover
                open={menuOpen}
                onOpenChange={(o) => {
                  setMenuOpen(o);
                  if (!o) setConfirmingDelete(false);
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        aria-label={t("extensions.moreOptions")}
                      >
                        <IconDots className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("extensions.moreOptions")}</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" sideOffset={4} className="w-72 p-0">
                  {!confirmingDelete ? (
                    <>
                      <div className="px-3 py-2 border-b border-border/40">
                        <p className="text-[12px] font-medium">
                          {t("extensions.appearsIn")}
                        </p>
                        {slots.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {t("extensions.noWidgetAreas")}
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {t("extensions.widgetAreaCount", {
                              count: slots.length,
                            })}
                          </p>
                        )}
                      </div>
                      {slots.length > 0 && (
                        <div className="max-h-48 overflow-y-auto py-1">
                          {slots.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                            >
                              <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                                {s.slotId}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemoveFromSlot(s.slotId)
                                    }
                                    className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground cursor-pointer"
                                    aria-label={t(
                                      "extensions.removeFromWidgetArea",
                                    )}
                                  >
                                    <IconX className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("extensions.removeFromWidgetAreaForMe")}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="border-t border-border/40 p-1">
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(true)}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 cursor-pointer text-left"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          <span>
                            {existingTool?.canDelete === false
                              ? t("extensions.removeFromMyListEllipsis")
                              : t("extensions.deleteExtensionEllipsis")}
                          </span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2 p-3">
                      <p className="text-[12px]">
                        {existingTool?.canDelete === false
                          ? t("extensions.removeQuestion", { name })
                          : t("extensions.deleteQuestion", { name })}{" "}
                        {existingTool?.canDelete === false
                          ? t("extensions.hideForYouDescription")
                          : t("extensions.deleteEverywhereConfirmation")}
                      </p>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(false)}
                          className="rounded-md px-2 py-1 text-[12px] hover:bg-accent cursor-pointer"
                        >
                          {t("extensions.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={deleting}
                          className={cn(
                            "rounded-md bg-destructive px-2 py-1 text-[12px] text-destructive-foreground hover:bg-destructive/90 cursor-pointer",
                            deleting && "opacity-60",
                          )}
                        >
                          {deleting
                            ? existingTool?.canDelete === false
                              ? t("extensions.removing")
                              : t("extensions.deleting")
                            : existingTool?.canDelete === false
                              ? t("extensions.remove")
                              : t("extensions.delete")}
                        </button>
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-1/2 flex-col gap-4 overflow-auto border-r p-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t("extensions.nameLabel")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("extensions.namePlaceholder")}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t("extensions.descriptionLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("extensions.descriptionPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
            </div>

            <div className="flex flex-1 flex-col">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t("extensions.contentLabel")}
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("extensions.contentPlaceholder")}
                className="flex-1 resize-none rounded-md border border-input bg-background p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="w-1/2">
            {content ? (
              <iframe
                srcDoc={content}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-forms"
                title={t("extensions.previewTitle")}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("extensions.previewEmpty")}
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
