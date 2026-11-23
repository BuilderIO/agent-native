import type { ProjectDocument } from "@/lib/model/contracts";

export function mergeSavedCell(
  current: ProjectDocument,
  saved: ProjectDocument,
  cellId: string,
  expectedUpdatedAt: string | undefined,
): ProjectDocument {
  if (
    current.id !== saved.id ||
    current.workingVersionId !== saved.workingVersionId ||
    expectedUpdatedAt === undefined
  )
    return current;
  const existing = current.cells.find((cell) => cell.id === cellId);
  const updated = saved.cells.find((cell) => cell.id === cellId);
  if (!existing || !updated || existing.updatedAt !== expectedUpdatedAt)
    return current;
  return {
    ...current,
    cells: current.cells.map((cell) => (cell.id === cellId ? updated : cell)),
  };
}
