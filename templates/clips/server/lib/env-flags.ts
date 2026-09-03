export function enabledFlag(value: string | null | undefined): boolean {
  const flag = (value ?? "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes" || flag === "on";
}
