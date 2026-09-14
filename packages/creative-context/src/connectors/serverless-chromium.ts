export interface ServerlessChromiumRuntime {
  args?: string[];
  executablePath(packUrl?: string): Promise<string>;
}

const CHROMIUM_PACK_VERSION = "149.0.0";

export function chromiumPackUrl(
  architecture: NodeJS.Architecture = process.arch,
): string {
  const packArchitecture = architecture === "arm64" ? "arm64" : "x64";
  return (
    process.env.AGENT_NATIVE_CHROMIUM_PACK_URL?.trim() ||
    `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_PACK_VERSION}` +
      `/chromium-v${CHROMIUM_PACK_VERSION}-pack.${packArchitecture}.tar`
  );
}

export async function loadOptionalServerlessChromium(): Promise<ServerlessChromiumRuntime | null> {
  const specifier = "@sparticuz/chromium-min";
  try {
    const module = (await import(/* @vite-ignore */ specifier)) as unknown as {
      default?: Partial<ServerlessChromiumRuntime>;
    } & Partial<ServerlessChromiumRuntime>;
    const chromium = module.default ?? module;
    return typeof chromium.executablePath === "function"
      ? (chromium as ServerlessChromiumRuntime)
      : null;
  } catch {
    // coercion-ok: this optional capability is absent in non-serverless installs.
    return null;
  }
}
