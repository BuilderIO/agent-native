export function parseArgs(args?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const argv = args || process.argv.slice(2);
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      result[key] = rest.join("=") || "true";
    }
  }
  return result;
}

export function output(data: any): string {
  return JSON.stringify(data, null, 2);
}
