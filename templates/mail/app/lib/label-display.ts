export function mailLabelDisplayName(name: string): string {
  return name
    .slice(name.lastIndexOf("/") + 1)
    .replace(/_/g, " ")
    .toLowerCase();
}
