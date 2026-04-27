import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconArrowLeft } from "@tabler/icons-react";
import { ShareButton } from "../sharing/ShareButton.js";

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
  const queryClient = useQueryClient();

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
        {/* Skeleton: small breadcrumb */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
        </div>
        {/* Skeleton: full content area */}
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
      {/* Minimal breadcrumb bar — just back link + name + share */}
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
        <ShareButton
          resourceType="tool"
          resourceId={toolId}
          resourceTitle={tool.name}
        />
      </div>
      {/* Full-bleed iframe — no padding */}
      <iframe
        src={`/_agent-native/tools/${toolId}/render?dark=${isDark}`}
        className="flex-1 w-full border-0"
        sandbox="allow-scripts allow-same-origin"
        title={tool.name}
      />
    </div>
  );
}
