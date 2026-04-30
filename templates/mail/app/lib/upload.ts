import { appApiPath } from "@/lib/api-path";

export interface UploadResult {
  url: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const buffer = await file.arrayBuffer();
  const resp = await fetch(
    appApiPath(`/api/media/upload?filename=${encodeURIComponent(file.name)}`),
    {
      method: "POST",
      body: buffer,
    },
  );
  if (!resp.ok) {
    throw new Error(`Upload failed: ${resp.statusText}`);
  }
  return resp.json();
}

export function openFilePicker(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    // Handle cancel
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
