export async function refreshAndSelectRun(
  refetch: () => Promise<unknown>,
  runId: string,
  selectRun: (id: string) => void,
) {
  await refetch();
  selectRun(runId);
}
