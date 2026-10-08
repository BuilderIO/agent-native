export const SESSION_PAGE_SIZE = 100;

export function readSessionPage(value: string | null | undefined): number {
  if (value == null) return 1;
  if (!/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) &&
    Number.isSafeInteger((page - 1) * SESSION_PAGE_SIZE)
    ? page
    : 1;
}
