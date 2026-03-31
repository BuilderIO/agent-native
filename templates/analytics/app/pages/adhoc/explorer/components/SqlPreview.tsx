import { useState } from "react";
import { IconChevronRight, IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SqlPreviewProps {
  sql: string;
}

export function SqlPreview({ sql }: SqlPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border rounded-lg">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <IconChevronRight
          className={cn(
            "h-4 w-4 transition-transform",
            expanded && "rotate-90",
          )}
        />
        SQL Query
      </button>
      {expanded && (
        <div className="relative border-t">
          <pre className="p-3 text-xs overflow-auto max-h-[300px] bg-muted/50 font-mono">
            {sql}
          </pre>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6"
            onClick={handleCopy}
          >
            {copied ? (
              <IconCheck className="h-3 w-3" />
            ) : (
              <IconCopy className="h-3 w-3" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
