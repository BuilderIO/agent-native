import { startFakeProviders } from "../../local/fake-providers.js";
import { modelControlInput } from "./ask-control.js";
import { startControlServer } from "./control-server.js";

const fixture = await startFakeProviders({
  port: 4413,
  serveAnthropicDirectly: true,
});
const control = await startControlServer(
  4414,
  "/phase1/model-control",
  modelControlInput,
  async (input) => {
    const response = await fetch(
      "http://127.0.0.1:4412/phase1/worker-control",
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok)
      throw new Error(`Ask readiness worker control HTTP ${response.status}`);
    const receipt = await response.json();
    if (receipt?.unavailable !== input.unavailable)
      throw new Error(
        "Ask readiness worker control did not acknowledge the switch",
      );
    return { unavailable: input.unavailable };
  },
).catch(async (error) => {
  await fixture.close();
  throw error;
});
console.log(`Phase 1 model fixture listening at ${fixture.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    control.close();
    void fixture.close().then(() => process.exit(0));
  });
}
