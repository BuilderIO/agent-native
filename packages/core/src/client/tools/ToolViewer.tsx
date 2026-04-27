import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconArrowLeft, IconPencil } from "@tabler/icons-react";
import { ShareButton } from "../sharing/ShareButton.js";
import { sendToAgentChat } from "../agent-chat.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";

interface Tool {
  id: string;
  name: string;
  description?: string;
  content?: string;
}

export interface ToolViewerProps {
  toolId: string;
}

function EditToolPopover({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");

  const handleSubmit = () => {
    if (!editPrompt.trim()) return;
    sendToAgentChat({
      message: editPrompt.trim(),
      context: `The user is viewing tool "${tool.name}" (id: ${tool.id}) and wants to edit it.`,
      submit: true,
      openSidebar: true,
    });
    setEditPrompt("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-9 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground cursor-pointer"
        >
          <IconPencil className="h-4 w-4" />
          <span>Edit</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="What would you like to change?"
            className="flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[100px] resize-y"
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (editPrompt.trim()) handleSubmit();
              }
            }}
          />
          <div className="flex justify-end mt-3">
            <button
              type="submit"
              disabled={!editPrompt.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Send
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ToolViewer({ toolId }: ToolViewerProps) {
  const [isDark, setIsDark] = useState(false);

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

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
        </div>
        <div className="flex-1 bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Tool not found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Link
            to="/tools"
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <span className="text-sm font-medium">{tool.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <EditToolPopover tool={tool} />
          <ShareButton
            resourceType="tool"
            resourceId={toolId}
            resourceTitle={tool.name}
          />
        </div>
      </div>
      <iframe
        src={`/_agent-native/tools/${toolId}/render?dark=${isDark}`}
        className="flex-1 w-full border-0"
        sandbox="allow-scripts allow-same-origin"
        title={tool.name}
      />
    </div>
  );
}
