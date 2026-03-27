import { useMemo, useState } from "react";
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";
import type { EnrichmentJob, ImportRecord } from "@shared/types";
import { useImports } from "@/hooks/use-imports";
import { useEnrichmentsForImport } from "@/hooks/use-enrichments";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { UploadZone } from "@/components/upload-zone";
import { DataTable } from "@/components/data-table";
import { EnrichmentStatus } from "@/components/enrichment-status";
import { ExportButton } from "@/components/export-button";

export function meta() {
  return [{ title: "Data Enrichment" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export default function EnrichmentPage() {
  const { imports, isLoading: importsLoading } = useImports();
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const activeImport = imports.find((i) => i.id === selectedImportId) ?? null;

  const { enrichments } = useEnrichmentsForImport(selectedImportId);

  const activeJob =
    enrichments.find((j) => j.id === selectedJobId) ?? null;

  function handleUpload(record: ImportRecord) {
    setSelectedImportId(record.id);
    setSelectedJobId(null);
    setUploadDialogOpen(false);
  }

  function handleImportChange(id: string) {
    setSelectedImportId(id);
    setSelectedJobId(null);
  }

  function handleJobChange(id: string) {
    setSelectedJobId(id);
  }

  const { tableRows, tableColumns, enrichedColumns } = useMemo(() => {
    if (activeJob && activeJob.results.length > 0) {
      const enrichedCols = Object.keys(
        activeJob.results[0]?.enriched ?? {},
      );
      const origCols = Object.keys(
        activeJob.results[0]?.originalRow ?? {},
      );
      return {
        tableColumns: [...origCols, ...enrichedCols],
        enrichedColumns: enrichedCols,
        tableRows: activeJob.results.map((r) => ({
          ...r.originalRow,
          ...Object.fromEntries(
            Object.entries(r.enriched).map(([k, v]) => [k, v ?? ""]),
          ),
        })),
      };
    }

    if (activeImport) {
      return {
        tableColumns: activeImport.columns,
        enrichedColumns: [] as string[],
        tableRows: activeImport.rows,
      };
    }

    return { tableColumns: [], enrichedColumns: [] as string[], tableRows: [] };
  }, [activeJob, activeImport]);

  const hasImports = imports.length > 0;

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <h2 className="text-sm font-medium text-foreground">
          Data Enrichment
        </h2>
        <AgentToggleButton />
      </header>

      <AgentSidebar
        position="left"
        defaultOpen
        emptyStateText="What would you like to enrich?"
        suggestions={[
          "Enrich my CSV with company data",
          "Add enrichment fields like LinkedIn URL, funding, employee count",
          "Export my enriched results as CSV",
        ]}
      >
        <div className="flex flex-col flex-1 overflow-hidden">
          {importsLoading ? (
            <div className="flex items-center justify-center flex-1">
              <Spinner className="h-8 w-8" />
            </div>
          ) : !hasImports ? (
            <div className="flex flex-col items-center justify-center flex-1 px-6">
              <div className="max-w-md w-full space-y-6">
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    Get started
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Upload a CSV file to begin enriching your data with
                    AI-powered search.
                  </p>
                </div>
                <UploadZone onUpload={handleUpload} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                <Select
                  value={selectedImportId ?? ""}
                  onValueChange={handleImportChange}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Select an import..." />
                  </SelectTrigger>
                  <SelectContent>
                    {imports.map((imp) => (
                      <SelectItem key={imp.id} value={imp.id}>
                        {imp.filename}{" "}
                        <span className="text-muted-foreground">
                          ({new Date(imp.uploadedAt).toLocaleDateString()})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {enrichments.length > 0 && (
                  <Select
                    value={selectedJobId ?? ""}
                    onValueChange={handleJobChange}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select a job..." />
                    </SelectTrigger>
                    <SelectContent>
                      {enrichments.map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.searchType} — {job.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <Dialog
                    open={uploadDialogOpen}
                    onOpenChange={setUploadDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        New Upload
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Upload CSV</DialogTitle>
                      </DialogHeader>
                      <UploadZone onUpload={handleUpload} />
                    </DialogContent>
                  </Dialog>

                  {activeImport && (
                    <Button
                      size="sm"
                      onClick={() =>
                        sendToAgentChat({
                          message: `Enrich the dataset "${activeImport.filename}" (import ${activeImport.id}). Use Exa Websets to find and enrich the data.`,
                        })
                      }
                    >
                      Enrich
                    </Button>
                  )}
                </div>
              </div>

              {activeJob && (
                <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-muted/30 shrink-0">
                  <EnrichmentStatus job={activeJob} />
                  <ExportButton job={activeJob} />
                </div>
              )}

              <div className="flex-1 overflow-auto p-4">
                {selectedImportId ? (
                  <DataTable
                    rows={tableRows}
                    columns={tableColumns}
                    enrichedColumns={enrichedColumns}
                    emptyMessage="No data in this import."
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select an import to view its data.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </AgentSidebar>
    </div>
  );
}
