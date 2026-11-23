export const PROJECT_LIST_SEARCH_MAX_LENGTH = 200;

export const WORKSPACE_SEARCH_TEXT_MAX_LENGTH = 500;

export function clampSearchText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}
