type Dependency = { processing?: Promise<void> };
export const CLIENT_ENTRIES = [
  "/app/entry.client.tsx",
  "/app/root.tsx",
  "/app/routes/home.tsx",
  "/app/components/workspace/HomePageView.tsx",
  "/app/components/agent/index.ts",
  "/app/components/notebook/NotebookCell.tsx",
];

type Client = {
  transformRequest(url: string): Promise<unknown>;
  waitForRequestsIdle(): Promise<void>;
  depsOptimizer?: {
    scanProcessing?: Promise<void>;
    metadata: {
      optimized: Record<string, Dependency>;
      discovered: Record<string, Dependency>;
    };
  };
};

export async function prepareClient(client: Client) {
  await client.depsOptimizer?.scanProcessing;
  await Promise.all(CLIENT_ENTRIES.map((url) => client.transformRequest(url)));
  await client.waitForRequestsIdle();
  const metadata = client.depsOptimizer?.metadata;
  await Promise.all(
    Object.values({ ...metadata?.optimized, ...metadata?.discovered }).map(
      (dependency) => dependency.processing,
    ),
  );
}
