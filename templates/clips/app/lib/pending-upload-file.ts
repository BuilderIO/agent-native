let pendingUploadFile: File | null = null;

export function setPendingUploadFile(file: File): void {
  pendingUploadFile = file;
}

export function hasPendingUploadFile(): boolean {
  return pendingUploadFile !== null;
}

export function takePendingUploadFile(): File | null {
  const file = pendingUploadFile;
  pendingUploadFile = null;
  return file;
}
