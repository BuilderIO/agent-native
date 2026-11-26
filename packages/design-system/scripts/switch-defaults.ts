import { readSwitchComponent } from "../src/tokens/component-inputs.js";

export function renderSwitchDefaults(css: string, group: unknown) {
  const { inputs } = readSwitchComponent(group);
  const knownInputs = new Map(Object.entries(inputs));
  const used = new Set<string>();
  const inputUse =
    /var\((\s*)(--switch-[a-z-]+)(\s*,\s*)(?:var\(--[\w-]+\)|[^\s()]+)(\s*)\)/g;
  const rendered = css.replace(
    inputUse,
    (
      _match,
      space: string,
      name: string,
      comma: string,
      end: string,
      offset: number,
    ) => {
      const input = knownInputs.get(name);
      if (!input) throw new Error("Unknown Switch CSS input " + name);
      const selector = css.slice(
        css.lastIndexOf("}", offset) + 1,
        css.lastIndexOf("{", offset),
      );
      const contextual =
        name === "--switch-radius" && selector.includes(".switch[data-radius]");
      const fallback = contextual ? "var(--shape-control)" : input.fallback;
      if (!contextual) used.add(name);
      return "var(" + space + name + comma + fallback + end + ")";
    },
  );
  for (const name of knownInputs.keys()) {
    if (!used.has(name)) throw new Error("Missing Switch CSS input " + name);
  }
  return rendered;
}
