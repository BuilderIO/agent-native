import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useGCloudLogs } from "./hooks";
import type { TimePeriod, ServiceType, LogEntry } from "./types";

const SEVERITY_OPTIONS = [
  { label: "All", value: "" },
  { label: "Error", value: "ERROR" },
  { label: "Warning", value: "WARNING" },
  { label: "Info", value: "INFO" },
  { label: "Debug", value: "DEBUG" },
];

const SEVERITY_COLORS: Record<string, string> = {
  EMERGENCY: "text-red-500 bg-red-500/10",
  ALERT: "text-red-500 bg-red-500/10",
  CRITICAL: "text-red-500 bg-red-500/10",
  ERROR: "text-red-400 bg-red-400/10",
  WARNING: "text-amber-400 bg-amber-400/10",
  NOTICE: "text-blue-400 bg-blue-400/10",
  INFO: "text-blue-400 bg-blue-400/10",
  DEBUG: "text-gray-400 bg-gray-400/10",
  DEFAULT: "text-gray-400 bg-gray-400/10",
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getLogMessage(entry: LogEntry): string {
  if (entry.textPayload) return entry.textPayload;
  if (entry.jsonPayload) {
    const msg =
      (entry.jsonPayload.message as string) ||
      (entry.jsonPayload.msg as string) ||
      (entry.jsonPayload.textPayload as string);
    if (msg) return msg;
    return JSON.stringify(entry.jsonPayload, null, 2);
  }
  return "(empty)";
}

interface LogRowProps {
  entry: LogEntry;
}

function LogRow({ entry }: LogRowProps) {
  const [expanded, setExpanded] = useState(false);
  const message = getLogMessage(entry);
  const colorClass = SEVERITY_COLORS[entry.severity] || SEVERITY_COLORS.DEFAULT;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2"
      >
        <span className="mt-0.5 flex-shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="text-xs text-muted-foreground flex-shrink-0 w-[140px]">
          {formatTimestamp(entry.timestamp)}
        </span>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 w-[60px] text-center ${colorClass}`}
        >
          {entry.severity}
        </span>
        <span className="text-xs text-foreground truncate flex-1 font-mono">
          {message.split("\n")[0]}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pl-10">
          <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
            {message}
          </pre>
          <div className="mt-2 text-[10px] text-muted-foreground space-x-4">
            <span>Resource: {entry.resource.type}</span>
            {entry.resource.labels.service_name && (
              <span>Service: {entry.resource.labels.service_name}</span>
            )}
            {entry.resource.labels.revision_name && (
              <span>Revision: {entry.resource.labels.revision_name}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface LogsPanelProps {
  service: string | undefined;
  period: TimePeriod;
  type: ServiceType;
}

export function LogsPanel({ service, period, type }: LogsPanelProps) {
  const [severity, setSeverity] = useState("");
  const limit = period === "1h" ? 50 : 100;

  const { data: entries, isLoading } = useGCloudLogs(
    service,
    severity || undefined,
    limit,
    type,
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-card-foreground">
          Recent Logs
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSeverity(opt.value)}
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  severity === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!service ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Select a service to view logs
        </div>
      ) : isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
          Loading logs...
        </div>
      ) : !entries?.length ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No log entries found
        </div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto">
          {entries.map((entry) => (
            <LogRow key={entry.insertId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
