export function createRecordId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function timestamp(input?: string): string {
  return input ?? new Date().toISOString();
}
