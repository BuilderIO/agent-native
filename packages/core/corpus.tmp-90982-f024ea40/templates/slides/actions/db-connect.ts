function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

export default async function main(args: string[]) {
  const { url, token, help } = parseArgs(args);

  if (help) {
    console.log(
      "Usage: pnpm action db-connect --url <DATABASE_URL> [--token <DATABASE_AUTH_TOKEN>]",
    );
    console.log(
      "\nDATABASE_URL and DATABASE_AUTH_TOKEN are deployment-level settings.",
    );
    return;
  }

  if (!url) {
    console.error("Error: --url is required");
    throw new Error("Script failed");
  }

  console.log(`\nDatabase connection not written locally`);
  console.log(
    `  DATABASE_URL=${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//***@")}`,
  );
  if (token) console.log(`  DATABASE_AUTH_TOKEN=***`);
  console.log(
    `\nConfigure these as deployment environment variables with your host, then redeploy.`,
  );
}
