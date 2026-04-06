import { useState, useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogEntry {
  timestamp: Date;
  type: "error" | "info" | "warning";
  message: string;
  details?: any;
}

export function DebugPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Intercept console.error and console.log
    const originalError = console.error;
    const originalLog = console.log;

    console.error = (...args: any[]) => {
      originalError(...args);
      setLogs((prev) => [
        ...prev.slice(-20), // Keep only last 20 logs
        {
          timestamp: new Date(),
          type: "error",
          message: args[0]?.toString() || "Unknown error",
          details: args.length > 1 ? args.slice(1) : undefined,
        },
      ]);
      setIsOpen(true); // Auto-open on error
    };

    console.log = (...args: any[]) => {
      originalLog(...args);
      // Only log specific debug messages (those with "Full error details" or "Voice")
      const message = args[0]?.toString() || "";
      if (message.includes("Full error details") || message.includes("Voice")) {
        setLogs((prev) => [
          ...prev.slice(-20),
          {
            timestamp: new Date(),
            type: "info",
            message,
            details: args.length > 1 ? args.slice(1) : undefined,
          },
        ]);
      }
    };

    return () => {
      console.error = originalError;
      console.log = originalLog;
    };
  }, []);

  if (logs.length === 0) return null;

  return (
    <div
      className={cn(
        "fixed bottom-20 right-6 z-[100] w-96 max-h-[500px] overflow-hidden",
        "bg-card/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl",
        "transition-all duration-300",
        isOpen
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0 pointer-events-none",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-medium">Debug Logs</span>
          <span className="text-xs text-muted-foreground">({logs.length})</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Logs */}
      <div className="overflow-y-auto max-h-[400px] p-4 space-y-2">
        {logs.map((log, index) => (
          <div
            key={index}
            className={cn(
              "p-3 rounded-lg text-xs font-mono",
              log.type === "error" && "bg-red-500/10 border border-red-500/20",
              log.type === "info" && "bg-blue-500/10 border border-blue-500/20",
              log.type === "warning" &&
                "bg-orange-500/10 border border-orange-500/20",
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span
                className={cn(
                  "font-semibold",
                  log.type === "error" && "text-red-400",
                  log.type === "info" && "text-blue-400",
                  log.type === "warning" && "text-orange-400",
                )}
              >
                {log.type.toUpperCase()}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {log.timestamp.toLocaleTimeString()}
              </span>
            </div>
            <div className="text-foreground/80 break-words whitespace-pre-wrap">
              {log.message}
            </div>
            {log.details && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Details
                </summary>
                <pre className="mt-2 text-[10px] overflow-x-auto">
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/10 flex justify-between items-center">
        <button
          onClick={() => setLogs([])}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear logs
        </button>
        <span className="text-[10px] text-muted-foreground">DEV MODE ONLY</span>
      </div>
    </div>
  );
}
