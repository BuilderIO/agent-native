export function canReadRecordingComments(input: {
  enableComments: boolean;
  viewerIsOwner: boolean;
}): boolean {
  return input.enableComments || input.viewerIsOwner;
}
