export function isCheckpointRestorePath(path: string | undefined): boolean {
  if (!path) return false;
  return (
    /(^|\/)checkpoints\/restore(?:[/?]|$)/.test(path) ||
    /^\/?restore(?:[/?]|$)/.test(path)
  );
}
