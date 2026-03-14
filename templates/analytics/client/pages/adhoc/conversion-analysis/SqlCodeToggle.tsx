import { useState } from "react";
import { ChevronDown, Code } from "lucide-react";
import { cn } from "@/lib/utils";

interface SqlCodeToggleProps {
  sql: string;
  title?: string;
}

export function SqlCodeToggle({
  sql,
  title = "View SQL Query",
}: SqlCodeToggleProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Code className="h-3.5 w-3.5" />
        <span className="font-medium">{title}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="mt-3">
          <pre className="text-[10px] bg-muted p-3 rounded-lg overflow-x-auto border border-border leading-relaxed">
            <code className="text-foreground/90">{sql}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
