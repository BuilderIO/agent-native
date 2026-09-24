import type { ReactNode } from "react";

export type DesignSystemSourceInput =
  | { id: string; kind: "website"; url: string }
  | { id: string; kind: "figma"; url: string }
  | {
      id: string;
      kind: "file";
      name: string;
      mimeType: string;
      size: number;
      handle:
        | { kind: "stored-file"; path: string }
        | { kind: "builder-upload"; uploadToken: string };
    };

export type DesignSystemSourceKind = "website" | "files" | "figma";

export type DesignSystemFileHandle = Extract<
  DesignSystemSourceInput,
  { kind: "file" }
>["handle"];
export type StagedDesignSystemSource = DesignSystemSourceInput;
export type DesignSystemFileUploadResult = Omit<
  Extract<DesignSystemSourceInput, { kind: "file" }>,
  "id" | "kind"
>;

export interface DesignSystemSourceBatch {
  requestId: string;
  sources: StagedDesignSystemSource[];
}

export interface CreateDesignSystemInput extends DesignSystemSourceBatch {
  name: string;
  intent: "fresh" | "references";
}

export interface CreatedDesignSystem {
  systemId: string;
  title?: string;
  snapshot?: unknown;
}

export interface DesignSystemUpload {
  id: string;
  file: File;
  source: "files";
  status: "pending" | "uploading" | "failed";
  progress?: number;
  error?: string;
  retryable?: boolean;
}

export interface DesignSystemCreationDraft {
  requestId: string;
  name: string;
  intent: "fresh" | "references";
  step: "start" | "sources";
  openSources: DesignSystemSourceKind[];
  websiteInput: string;
  figmaInput: string;
  sources: StagedDesignSystemSource[];
  uploads: DesignSystemUpload[];
}

export interface DesignSystemCreationLabels {
  title: string;
  sourcesTitle?: string;
  name: string;
  startFrom: string;
  fresh: string;
  freshDescription?: string;
  references: string;
  referencesDescription?: string;
  continue: string;
  back: string;
  cancel: string;
  create: string;
  addToSystem: string;
  add: string;
  added: string;
  website: string;
  files: string;
  figma: string;
  websiteUrl: string;
  figmaUrl: string;
  chooseFiles: string;
  fileTypes?: string;
  uploading: string;
  pending: string;
  retry: string;
  submitting: string;
  remove: (name: string) => string;
  nameRequired: string;
  sourceRequired: string;
  invalidWebsite: string;
  invalidFigma: string;
  unsupportedFile: string;
  emptyFile: string;
  fileTooLarge: string;
  uploadFailed: string;
  submitFailed: string;
}

export interface DesignSystemCreationOptions {
  labels: DesignSystemCreationLabels;
  addingToSystemId?: string;
  initialDraft?: DesignSystemCreationDraft;
  onDraftChange?: (draft: DesignSystemCreationDraft) => void;
  onCreate: (input: CreateDesignSystemInput) => Promise<CreatedDesignSystem>;
  onCreated?: (systemId: string, result: CreatedDesignSystem) => void;
  onAddSources?: (
    systemId: string,
    batch: DesignSystemSourceBatch,
  ) => Promise<void>;
  onSourcesAdded?: (systemId: string) => void;
  onCancel: () => void;
  uploadFile: (
    file: File,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void },
  ) => Promise<DesignSystemFileUploadResult>;
  sourceNotice?: Partial<Record<DesignSystemSourceKind, ReactNode>>;
}

export const DESIGN_SYSTEM_BRAND_FILE_ACCEPT =
  ".md,.txt,.csv,.json,.css,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.svg";
export const DESIGN_SYSTEM_MAX_FILE_BYTES = 20 * 1024 * 1024;
