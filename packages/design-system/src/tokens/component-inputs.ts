import {
  componentsToHex,
  EXTENSION,
  flattenTokens,
  hexToComponents,
  TokenError,
  type DtcgColor,
  type DtcgToken,
} from "./dtcg.js";
import componentFile from "./files/components.tokens.json" with { type: "json" };

export const COMPONENTS_FILE = "components.tokens.json";

function cssColor(value: unknown, file: string, name: string): DtcgColor {
  let channels: unknown;
  let alpha: unknown;
  if (typeof value === "string" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) {
    channels = hexToComponents(value.slice(0, 7));
    alpha = value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1;
  } else if (
    value &&
    typeof value === "object" &&
    "colorSpace" in value &&
    value.colorSpace === "srgb" &&
    "components" in value
  ) {
    channels = value.components;
    alpha = "alpha" in value ? value.alpha : 1;
  }
  function channel(n: unknown): n is number {
    return typeof n === "number" && n >= 0 && n <= 1;
  }
  if (
    !Array.isArray(channels) ||
    channels.length !== 3 ||
    !channels.every(channel) ||
    !channel(alpha)
  ) {
    throw new TokenError(
      file,
      name,
      "expected an sRGB color with components and alpha in the range 0–1",
    );
  }
  const components = channels as [number, number, number];
  return {
    colorSpace: "srgb",
    components,
    alpha,
    hex: componentsToHex(components),
  };
}

function rgba(value: DtcgColor) {
  const channels = [...value.components, value.alpha];
  if (
    channels.every((n) => Math.abs(n - Math.round(n * 255) / 255) < 0.00000051)
  ) {
    return (
      value.hex +
      (value.alpha === 1
        ? ""
        : Math.round(value.alpha * 255)
            .toString(16)
            .padStart(2, "0"))
    );
  }
  return "color(srgb " + value.components.join(" ") + " / " + value.alpha + ")";
}

function cssValue(token: DtcgToken, file: string, name: string) {
  const value = token.$value;
  switch (token.$type) {
    case "color":
      return rgba(cssColor(value, file, name));
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new TokenError(
          file,
          name,
          "expected a nonnegative size in CSS pixels",
        );
      return value + "px";
    case "string":
      if (
        typeof value !== "string" ||
        !/^(?:none|var\(--shadow-[1-6]\))$/.test(value)
      )
        throw new TokenError(
          file,
          name,
          "expected none or a shadow preset from var(--shadow-1) through var(--shadow-6)",
        );
      return value;
    default:
      throw new TokenError(file, name, "unsupported component token type");
  }
}

export function importComponentToken(
  file: string,
  name: string,
  current: DtcgToken,
  incoming: DtcgToken,
): DtcgToken {
  const value =
    incoming.$type === "color"
      ? cssColor(incoming.$value, file, name)
      : incoming.$value;
  const changed =
    cssValue({ ...incoming, $value: value }, file, name) !==
    cssValue(current, file, name);
  const extensions = { ...current.$extensions };
  if (changed) delete extensions[EXTENSION];
  for (const [key, extension] of Object.entries(incoming.$extensions ?? {})) {
    if (key !== EXTENSION) extensions[key] = extension;
  }
  return {
    ...current,
    $value: changed ? value : current.$value,
    ...(typeof incoming.$description === "string" &&
    incoming.$description.trim()
      ? { $description: incoming.$description }
      : {}),
    $extensions: extensions,
  };
}

export function readSwitchComponent(group: unknown) {
  const inputs: Record<string, { fallback: string; description: string }> = {};
  const colorLiterals: Record<string, string> = {};
  for (const [name, token] of flattenTokens(group, COMPONENTS_FILE)) {
    const value = cssValue(token, COMPONENTS_FILE, name);
    const binding = token.$extensions?.[EXTENSION];
    const property = "--" + name.replaceAll(".", "-");
    let fallback = value;
    if (binding !== undefined) {
      if (
        !binding ||
        typeof binding !== "object" ||
        !("cssVariable" in binding) ||
        typeof binding.cssVariable !== "string" ||
        !/^--[a-z][a-z0-9-]*$/.test(binding.cssVariable)
      )
        throw new TokenError(
          COMPONENTS_FILE,
          name,
          "invalid CSS variable binding",
        );
      fallback = "var(" + binding.cssVariable + ")";
    } else if (token.$type === "color") {
      const literalName = "--component" + property.slice(1);
      colorLiterals[literalName] = value;
      fallback = "var(" + literalName + ")";
    }
    inputs[property] = {
      fallback,
      description: token.$description ?? "",
    };
  }
  return { inputs, colorLiterals };
}

export const { inputs: switchCssInputs, colorLiterals: switchColorLiterals } =
  readSwitchComponent(componentFile);
