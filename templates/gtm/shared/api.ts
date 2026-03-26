export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
}

export interface SSEEvent {
  type: "change" | "add" | "unlink";
  path: string;
}
