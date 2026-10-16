export function isPolicyPermissionError(message: string): boolean {
  return /\bpermissions-policy\b/i.test(message);
}
