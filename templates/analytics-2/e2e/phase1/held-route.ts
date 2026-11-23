export async function settleHeldRoute(operation: () => Promise<void>) {
  try {
    await operation();
  } catch (error) {
    if (!String(error).includes("Route is already handled")) throw error;
  }
}
