/** Permission categories narrow an already-authorized project list. */
export function projectAccessFilterValue(
  role: string | undefined,
): string | undefined {
  switch (role) {
    case "owner":
    case "admin":
      return "full";
    case "editor":
      return "edit";
    case "commenter":
    case "viewer":
      return "explore";
    default:
      return undefined;
  }
}
