export interface ImportedDesignFile {
  filename: string;
  fileType: "html" | "css" | "jsx" | "asset";
  content: string;
  operationSource?: string;
  source?: Record<string, unknown>;
  preferredFrame?: {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  };
}
