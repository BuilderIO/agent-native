export interface ImportRecord {
  id: string;
  filename: string;
  uploadedAt: string;
  columns: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

export interface EnrichedRow {
  originalRow: Record<string, string>;
  enriched: Record<string, string | null>;
  websetItemId: string | null;
}

export interface EnrichmentJob {
  id: string;
  importId: string;
  status: "pending" | "running" | "completed" | "failed";
  websetId: string | null;
  searchType: "auto" | "people" | "companies";
  enrichments: string[];
  progress: { found: number; total: number };
  results: EnrichedRow[];
  error: string | null;
  lastExportId: string | null;
  createdAt: string;
  completedAt: string | null;
}
