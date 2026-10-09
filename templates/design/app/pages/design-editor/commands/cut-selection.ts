export interface CutSelectionArgs {
  copySelection: () => Promise<{ copied: boolean; written: boolean }>;
  deleteSelection: () => void;
  getSelectedLayerIds: () => readonly string[];
}

export async function runCutSelection({
  copySelection,
  deleteSelection,
  getSelectedLayerIds,
}: CutSelectionArgs): Promise<boolean> {
  const selectedBefore = [...getSelectedLayerIds()];
  const result = await copySelection();
  if (!result.copied || !result.written) return false;

  const selectedAfter = getSelectedLayerIds();
  if (
    selectedBefore.length !== selectedAfter.length ||
    selectedBefore.some((layerId, index) => layerId !== selectedAfter[index])
  ) {
    return false;
  }

  deleteSelection();
  return true;
}
