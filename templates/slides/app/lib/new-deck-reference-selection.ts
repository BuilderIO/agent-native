export interface NewDeckReferenceSelection {
  designSystemId: string | null;
  referenceDeckId: string | null;
}

export function resolveNewDeckReferenceSelection(args: {
  designSystemAuto: boolean;
  selectedDesignSystemId: string | null;
  defaultDesignSystemId: string | null;
  referenceDeckAuto: boolean;
  selectedReferenceDeckId: string | null;
  defaultReferenceDeckId: string | null;
}): NewDeckReferenceSelection {
  return {
    designSystemId: args.designSystemAuto
      ? args.defaultDesignSystemId
      : args.selectedDesignSystemId,
    referenceDeckId: args.referenceDeckAuto
      ? args.defaultReferenceDeckId
      : args.selectedReferenceDeckId,
  };
}
