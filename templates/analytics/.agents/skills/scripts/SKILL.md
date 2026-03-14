# Agent Scripts

## Rule

Complex operations the agent needs to perform are implemented as scripts in `scripts/`. The agent runs them via `pnpm script <name>`.

## Why

Scripts give the agent callable tools with structured input/output. They keep the agent's chat context clean (no massive code blocks), they're reusable, and they can be tested independently.

## How to Create a Script

Create `scripts/my-script.ts`:

```ts
import { parseArgs, loadEnv, fail } from "@agent-native/core";
import { agentChat } from "@agent-native/core";

export default async function myScript(args: string[]) {
  loadEnv(); // loads .env

  const { input, output } = parseArgs(args);
  if (!input) fail("--input is required");

  // Do the work...
  const result = processData(input);

  // Write result to a file
  fs.writeFileSync(output || "data/result.json", JSON.stringify(result, null, 2));

  // Optionally report back to agent chat
  agentChat.submit(`Processed ${input}, result saved to ${output}`);
}
```

## How to Run

```bash
pnpm script my-script --input data/source.json --output data/result.json
```

The script dispatcher (`scripts/run.ts`) dynamically imports the script file and calls its default export.

## Guidelines

- **One script, one job.** Keep scripts focused on a single operation.
- **Use `parseArgs()`** for structured argument parsing. It converts `--key value` pairs to an object.
- **Use `loadEnv()`** if the script needs environment variables (API keys, etc.).
- **Use `fail()`** for user-friendly error messages (exits with message, no stack trace).
- **Write results to files.** The agent and UI will pick them up via the file watcher.
- **Use `agentChat.submit()`** to report results or errors back to the agent chat.

## Common Patterns

**API integration script** (e.g., image generation):
```ts
export default async function generateImage(args: string[]) {
  const { prompt, outputPath } = parseArgs(args);
  const imageUrl = await callImageAPI(prompt);
  const buffer = await fetch(imageUrl).then(r => r.arrayBuffer());
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}
```

**Data processing script:**
```ts
export default async function transform(args: string[]) {
  const { source } = parseArgs(args);
  const data = JSON.parse(fs.readFileSync(source, "utf-8"));
  const result = data.map(transformItem);
  fs.writeFileSync(source, JSON.stringify(result, null, 2));
}
```
