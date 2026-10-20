export function shouldStopNativeHostPolling(status: number): boolean {
  return status === 401 || status === 404 || status === 503;
}
