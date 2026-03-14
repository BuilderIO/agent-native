export interface FileRecord {
  path: string;
  content: string;
  app: string;
  ownerId: string;
  lastUpdated: number;
  createdAt?: number;
}

export interface FileChange {
  type: "added" | "modified" | "removed";
  id: string;
  data: FileRecord;
}

export type Unsubscribe = () => void;

export interface FileSyncAdapter {
  query(appId: string, ownerId: string): Promise<{ id: string; data: FileRecord }[]>;
  get(id: string): Promise<{ id: string; data: FileRecord } | null>;
  set(id: string, record: Partial<FileRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  subscribe(
    appId: string,
    ownerId: string,
    onChange: (changes: FileChange[]) => void,
    onError: (error: any) => void,
  ): Unsubscribe;
}
