import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  IconArrowLeft,
  IconPencil,
  IconX,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { ShareButton } from "../sharing/ShareButton.js";
import { cn } from "../utils.js";

interface Tool {
  id: string;
  name: string;
  description?: string;
  content?: string;
}

export interface ToolViewerProps {
  toolId: string;
}

export function ToolViewer({ toolId }: ToolViewerProps) {
  const [isDark, setIsDark] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const { data: tool, isLoading } = useQuery<Tool>({
    queryKey: ["tool", toolId],
    queryFn: async () => {
      const res = await fetch(`/_agent-native/tools/${toolId}`);
      if (!res.ok) throw new Error("Failed to fetch tool");
      return res.json();
    },
  });

  const handleEdit = () => {
    setEditContent(tool?.content ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/_agent-native/tools/${toolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) throw new Error("Save failed");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="h-5 w-5 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">Tool not found</p>
        <Link
          to="/tools"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to tools
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/tools"
            className="inline-flex cursor-pointer items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Back to tools"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-semibold">{tool.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <IconX className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={cn(
                  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90",
                  saving && "opacity-60",
                )}
              >
                <IconDeviceFloppy className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleEdit}
                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <IconPencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <ShareButton
                resourceType="tool"
                resourceId={toolId}
                resourceTitle={tool.name}
              />
            </>
          )}
        </div>
      </header>

      {editing ? (
        <div className="flex flex-1 gap-0 overflow-hidden">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-1/2 resize-none border-r bg-background p-4 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
            spellCheck={false}
            placeholder="Enter HTML content..."
          />
          <div className="w-1/2">
            <iframe
              srcDoc={editContent}
              className="h-full w-full border-0"
              sandbox="allow-scripts"
              title={`${tool.name} preview`}
            />
          </div>
        </div>
      ) : (
        <iframe
          src={`/_agent-native/tools/${toolId}/render?dark=${isDark}`}
          className="flex-1 border-0"
          sandbox="allow-scripts allow-same-origin"
          title={tool.name}
        />
      )}
    </div>
  );
}
