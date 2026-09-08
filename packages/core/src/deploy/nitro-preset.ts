import fs from "fs";
import path from "path";

export const AGENT_NATIVE_NITRO_PRESET_MARKER = path.join(
  ".agent-native",
  "nitro-preset",
);

function markerPath(cwd: string): string {
  return path.join(cwd, AGENT_NATIVE_NITRO_PRESET_MARKER);
}

export function clearAgentNativeNitroPresetMarker(cwd = process.cwd()): void {
  fs.rmSync(markerPath(cwd), { force: true });
}

export function writeAgentNativeNitroPresetMarker(
  preset: string,
  cwd = process.cwd(),
): void {
  const normalizedPreset = preset.trim();
  if (!normalizedPreset) return;

  const filePath = markerPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${normalizedPreset}\n`);
}

export function resolveAgentNativeNitroPreset({
  cwd = process.cwd(),
  env = process.env,
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string | undefined {
  const environmentPreset = env.NITRO_PRESET?.trim();
  if (environmentPreset) return environmentPreset;

  const filePath = markerPath(cwd);
  try {
    const marker = fs.readFileSync(filePath, "utf8").trim();
    if (!marker) {
      throw new Error(`Agent-Native Nitro preset marker is empty: ${filePath}`);
    }
    return marker;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
