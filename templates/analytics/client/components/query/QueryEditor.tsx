import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Loader2 } from "lucide-react";

interface QueryTemplate {
  label: string;
  sql: string;
}

const templates: QueryTemplate[] = [
  {
    label: "Signups Over Time (30d)",
    sql: `SELECT
  TIMESTAMP_TRUNC(createdDate, DAY) AS day,
  COUNT(*) AS signups
FROM @app_events
WHERE
  event = "signup"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day ASC`,
  },
  {
    label: "Active Users by Day (30d)",
    sql: `SELECT
  TIMESTAMP_TRUNC(createdDate, DAY) AS day,
  COUNT(DISTINCT userId) AS active_users
FROM @app_events
WHERE
  createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND userId IS NOT NULL
GROUP BY day
ORDER BY day ASC`,
  },
  {
    label: "Agent Chat Messages (30d)",
    sql: `SELECT
  TIMESTAMP_TRUNC(createdDate, DAY) AS day,
  COUNT(*) AS messages
FROM @app_events
WHERE
  event = "agent chat message submitted"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day ASC`,
  },
  {
    label: "Top Events (7d)",
    sql: `SELECT
  event,
  name,
  COUNT(*) AS count
FROM @app_events
WHERE
  createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY event, name
ORDER BY count DESC
LIMIT 50`,
  },
  {
    label: "Signups by Attribution (30d)",
    sql: `SELECT
  JSON_VALUE(data, '$.attributionBucket') AS source,
  COUNT(*) AS signups
FROM @app_events
WHERE
  event = "signup"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY source
ORDER BY signups DESC`,
  },
];

interface QueryEditorProps {
  onExecute: (sql: string) => void;
  isLoading?: boolean;
  initialSql?: string;
}

export function QueryEditor({
  onExecute,
  isLoading,
  initialSql,
}: QueryEditorProps) {
  const [sql, setSql] = useState(initialSql || "");

  useEffect(() => {
    if (initialSql) setSql(initialSql);
  }, [initialSql]);

  const handleTemplateSelect = (label: string) => {
    const tmpl = templates.find((t) => t.label === label);
    if (tmpl) {
      setSql(tmpl.sql);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Select onValueChange={handleTemplateSelect}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Load an example..." />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.label} value={t.label}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={() => onExecute(sql)}
          disabled={!sql.trim() || isLoading}
          size="sm"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Run Query
        </Button>
      </div>

      <Textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder="Enter any BigQuery SQL..."
        className="font-mono text-sm min-h-[200px] resize-y bg-background"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (sql.trim()) onExecute(sql);
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        Ctrl+Enter to run. You can use{" "}
        <code className="bg-secondary px-1 rounded">@app_events</code> as a
        shorthand for the app events table.
      </p>
    </div>
  );
}
