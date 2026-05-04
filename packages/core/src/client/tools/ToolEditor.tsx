import { agentNativePath } from "../api-path.js";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconDots,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { cn } from "../utils.js";

interface SlotDeclaration {
  id: string;
  toolId: string;
  slotId: string;
}

interface Tool {
  id: string;
  name: string;
  description?: string;
  content?: string;
}

export interface ToolEditorProps {
  toolId?: string;
}

export function ToolEditor({ toolId }: ToolEditorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!toolId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: slots = [] } = useQuery<SlotDeclaration[]>({
    queryKey: ["tool-slots", toolId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/slots/tool/${toolId}`),
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isEdit && menuOpen,
  });

  const { data: existingTool } = useQuery<Tool>({
    queryKey: ["tool", toolId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/tools/${toolId}`),
      );
      if (!res.ok) throw new Error("Failed to fetch tool");
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
          agentNativePath(`/_agent-native/tools/${toolId}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
          },
        );
        if (!res.ok) throw new Error("Update failed");
        queryClient.invalidateQueries({ queryKey: ["tool", toolId] });
        queryClient.invalidateQueries({ queryKey: ["tools"] });
        navigate(`/tools/${toolId}`);
      } else {
        const res = await fetch(agentNativePath("/_agent-native/tools"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) throw new Error("Create failed");
        const created = await res.json();
        queryClient.invalidateQueries({ queryKey: ["tools"] });
        navigate(`/tools/${created.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!toolId) return;
    setDeleting(true);
    try {
      const prev = queryClient.getQueryData<Tool[]>(["tools"]);
      queryClient.setQueryData<Tool[]>(["tools"], (old) =>
        (old ?? []).filter((t) => t.id !== toolId),
      );

      const res = await fetch(
        agentNativePath(`/_agent-native/tools/${toolId}`),
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        if (prev) queryClient.setQueryData(["tools"], prev);
        throw new Error("Delete failed");
      }

      queryClient.invalidateQueries({ queryKey: ["tools"] });
      slots.forEach((s) =>
        queryClient.invalidateQueries({
          queryKey: ["slot-installs", s.slotId],
        }),
      );
      navigate("/tools");
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
      setMenuOpen(false);
    }
  };

  const handleRemoveFromSlot = async (slotId: string) => {
    if (!toolId) return;
    try {
      await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/install/${encodeURIComponent(toolId)}`,
        ),
        { method: "DELETE" },
      );
    } finally {
      queryClient.invalidateQueries({ queryKey: ["slot-installs", slotId] });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to={isEdit ? `/tools/${toolId}` : "/tools"}
            className="inline-flex cursor-pointer items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-semibold">
            {isEdit ? "Edit Tool" : "New Tool"}
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
            {saving ? "Saving..." : isEdit ? "Save" : "Create"}
          </button>
          {isEdit && (
            <Popover
              open={menuOpen}
              onOpenChange={(o) => {
                setMenuOpen(o);
                if (!o) setConfirmingDelete(false);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title="More options"
                  aria-label="More options"
                >
                  <IconDots className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={4} className="w-72 p-0">
                {!confirmingDelete ? (
                  <>
                    <div className="px-3 py-2 border-b border-border/40">
                      <p className="text-[12px] font-medium">Appears in</p>
                      {slots.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                          Not installed in any widget areas. Ask the agent to
                          add it somewhere.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                          This tool can render in {slots.length} widget area
                          {slots.length === 1 ? "" : "s"}.
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
                            <button
                              type="button"
                              onClick={() => handleRemoveFromSlot(s.slotId)}
                              className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground cursor-pointer"
                              title="Remove from this widget area (for me)"
                              aria-label="Remove from this widget area"
                            >
                              <IconX className="h-3.5 w-3.5" />
                            </button>
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
                        <span>Delete tool…</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-2 p-3">
                    <p className="text-[12px]">
                      Delete <span className="font-medium">{name}</span>? This
                      removes the tool everywhere, for everyone it's shared
                      with.
                    </p>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        className="rounded-md px-2 py-1 text-[12px] hover:bg-accent cursor-pointer"
                      >
                        Cancel
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
                        {deleting ? "Deleting…" : "Delete"}
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
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Tool"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this tool do?"
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            />
          </div>

          <div className="flex flex-1 flex-col">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="<html>...</html>"
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
              title="Tool preview"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Preview will appear here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
