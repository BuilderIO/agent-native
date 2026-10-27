export function isBuilderIoEmployee(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase().endsWith("@builder.io") ?? false;
}

export function canShowThemeFamilySwitcher(input: {
  clientReady: boolean;
  authenticated: boolean;
  email: string | null | undefined;
  familyCount: number;
}): boolean {
  return (
    input.clientReady &&
    input.authenticated &&
    input.familyCount > 1 &&
    isBuilderIoEmployee(input.email)
  );
}
