export interface CutSelectionArgs {
  copySelection: () => Promise<{ copied: boolean; written: boolean }>;
  deleteSelection: () => void;
  getSelectedLayerIds: () => readonly string[];
  getSelectionContentKey: () => string;
}

export async function runCutSelection({
  copySelection,
  deleteSelection,
  getSelectedLayerIds,
  getSelectionContentKey,
}: CutSelectionArgs): Promise<boolean> {
  const selectedBefore = [...getSelectedLayerIds()];
  const contentBefore = getSelectionContentKey();
  const result = await copySelection();
  if (!result.copied || !result.written) return false;

  const selectedAfter = getSelectedLayerIds();
  if (
    selectedBefore.length !== selectedAfter.length ||
    selectedBefore.some((layerId, index) => layerId !== selectedAfter[index])
  ) {
    return false;
  }
  if (contentBefore !== getSelectionContentKey()) return false;

  deleteSelection();
  return true;
}
