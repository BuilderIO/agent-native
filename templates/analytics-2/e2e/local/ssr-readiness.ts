export async function waitForSsr(base: string) {
  for (let i = 0; i < 240; i++) {
    const response = await fetch(`${base}/home`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(120000),
    });
    const html = await response.text();
    if (response.ok && !html.includes("Dev server is restarting")) return;
    if (i === 239) throw new Error(`SSR not ready: HTTP ${response.status}`);
    await new Promise((done) => setTimeout(done, 500));
  }
}
