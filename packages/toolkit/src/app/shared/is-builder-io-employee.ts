export function isBuilderIoEmployee(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase().endsWith("@builder.io") ?? false;
}
