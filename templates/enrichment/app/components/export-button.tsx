import { useState } from "react";
import { Download } from "lucide-react";
import { sendToAgentChat } from "@agent-native/core/client";
import { API_BASE } from "@shared/api";
import type { EnrichmentJob } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface ExportButtonProps {
  job: EnrichmentJob;
}

export function ExportButton({ job }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  if (job.lastExportId) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={`${API_BASE}/exports/${job.lastExportId}`} download>
          <Download className="h-4 w-4" />
          Download CSV
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={job.status !== "completed" || loading}
      onClick={() => {
        setLoading(true);
        sendToAgentChat({
          message: `Export enrichment results for job ${job.id} as CSV`,
        });
        setTimeout(() => setLoading(false), 3000);
      }}
    >
      {loading ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      Export CSV
    </Button>
  );
}
