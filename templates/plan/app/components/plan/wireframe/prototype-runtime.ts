type RuntimeRecord = Record<string, unknown>;

type RuntimeContext = {
  aliases?: RuntimeRecord;
};

type EventDirective = {
  expression: string;
  prevent: boolean;
};

const TEMPLATE_ID_ATTR = "data-plan-prototype-template-id";
const CLONE_FOR_ATTR = "data-plan-prototype-clone-for";
export const RUNTIME_SENTINEL_ATTR = "data-plan-prototype-runtime-sentinel";
const MANAGED_CLASSES = new WeakMap<Element, Set<string>>();

const EVENT_KEY_MODIFIERS: Record<string, string> = {
  enter: "Enter",
  escape: "Escape",
  space: " ",
};
const URL_BOUND_ATTRIBUTES = new Set(["href", "src", "xlink:href", "poster"]);
const SAFE_BOUND_ATTRIBUTES = new Set([
  "alt",
  "checked",
  "disabled",
  "hidden",
  "role",
  "selected",
  "title",
  "value",
]);
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);/i;

export function mountPrototypeRuntime(root: HTMLElement): () => void {
  const islands = findRuntimeIslands(root);
  root.querySelectorAll(`[${RUNTIME_SENTINEL_ATTR}]`).forEach((node) => {
    node.remove();
  });
  const sentinel = document.createElement("span");
  sentinel.setAttribute(RUNTIME_SENTINEL_ATTR, "true");
  sentinel.hidden = true;
  root.appendChild(sentinel);
  const cleanups = islands.map((island) => mountRuntimeIsland(island));
  return () => {
    cleanups.forEach((cleanup) => cleanup());
    sentinel.remove();
  };
}

function findRuntimeIslands(root: HTMLElement): HTMLElement[] {
  const candidates = [
    ...(root.matches("[x-data]") ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>("[x-data]")),
  ];
  const islands = candidates.filter((candidate) => {
    const parent = candidate.parentElement?.closest("[x-data]");
    return !parent || parent === root.parentElement;
  });
  return islands.length > 0 ? islands : [root];
}

function mountRuntimeIsland(island: HTMLElement): () => void {
  const state = parseData(island.getAttribute("x-data"));
  const contextByElement = new WeakMap<Element, RuntimeContext>();
  let renderQueued = false;

  const render = () => {
    renderQueued = false;
    island
      .querySelectorAll(`[${CLONE_FOR_ATTR}]`)
      .forEach((clone) => clone.remove());
    renderElement(island, {}, contextByElement, island);
    island.dispatchEvent(
      new CustomEvent("plan-prototype-runtime:rendered", { bubbles: true }),
    );
  };
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    window.queueMicrotask(render);
  };
  const contextFor = (element: Element): RuntimeContext => {
    let current: Element | null = element;
    while (current && current !== island.parentElement) {
      const context = contextByElement.get(current);
      if (context) return context;
      if (current === island) break;
      current = current.parentElement;
    }
    return {};
  };
  const handleModel = (event: Event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      isInsideNestedIsland(target, island)
    ) {
      return;
    }
    const control = target.closest<HTMLElement>("[x-model]");
    if (!control || !island.contains(control)) return;
    const path = control.getAttribute("x-model");
    if (!path) return;
    const value =
      control instanceof HTMLInputElement && control.type === "checkbox"
        ? control.checked
        : control instanceof HTMLInputElement ||
            control instanceof HTMLTextAreaElement ||
            control instanceof HTMLSelectElement
          ? control.value
          : "";
    setPath(state, contextFor(control), path, value);
    scheduleRender();
  };
  const handleEvent = (event: Event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      isInsideNestedIsland(target, island)
    ) {
      return;
    }
    const match = findEventHandler(target, island, event);
    if (!match) return;
    if (match.directive.prevent || event.type === "submit") {
      event.preventDefault();
    }
    runStatements(state, contextFor(match.element), match.directive.expression);
    scheduleRender();
  };

  island.addEventListener("click", handleEvent);
  island.addEventListener("keydown", handleEvent);
  island.addEventListener("submit", handleEvent);
  island.addEventListener("input", handleModel);
  island.addEventListener("change", handleModel);
  render();

  return () => {
    island.removeEventListener("click", handleEvent);
    island.removeEventListener("keydown", handleEvent);
    island.removeEventListener("submit", handleEvent);
    island.removeEventListener("input", handleModel);
    island.removeEventListener("change", handleModel);
    island
      .querySelectorAll(`[${CLONE_FOR_ATTR}]`)
      .forEach((clone) => clone.remove());
    island
      .querySelectorAll(`[${TEMPLATE_ID_ATTR}]`)
      .forEach((template) => template.removeAttribute("hidden"));
  };

  function renderElement(
    element: Element,
    context: RuntimeContext,
    contexts: WeakMap<Element, RuntimeContext>,
    rootElement: Element,
  ) {
    if (element !== rootElement && isNestedRuntimeRoot(element)) return;
    if (element.hasAttribute(CLONE_FOR_ATTR) && !context.aliases) return;
    if (
      element.hasAttribute("x-for") &&
      !element.hasAttribute(CLONE_FOR_ATTR)
    ) {
      renderLoop(element as HTMLElement, context, contexts, rootElement);
      return;
    }

    contexts.set(element, context);
    applyText(element, context);
    applyShow(element, context);
    applyModel(element, context);
    applyBindings(element, context);

    for (const child of Array.from(element.children)) {
      renderElement(child, context, contexts, rootElement);
    }
  }

  function renderLoop(
    template: HTMLElement,
    context: RuntimeContext,
    contexts: WeakMap<Element, RuntimeContext>,
    rootElement: Element,
  ) {
    const expression = template.getAttribute("x-for") ?? "";
    const match = expression.match(/^\s*([A-Za-z_$][\w$]*)\s+in\s+(.+?)\s*$/);
    if (!match) return;
    const [, alias, sourceExpression] = match;
    const list = evaluateExpression(state, context, sourceExpression);
    const items = Array.isArray(list) ? list : [];
    const templateId = ensureTemplateId(template);
    template.hidden = true;
    template.setAttribute("aria-hidden", "true");
    template.parentElement
      ?.querySelectorAll(`[${CLONE_FOR_ATTR}="${cssEscape(templateId)}"]`)
      .forEach((clone) => clone.remove());

    let anchor: Element = template;
    items.forEach((item, index) => {
      const clone = template.cloneNode(true) as HTMLElement;
      clone.removeAttribute("x-for");
      clone.removeAttribute("hidden");
      clone.removeAttribute("aria-hidden");
      clone.setAttribute(CLONE_FOR_ATTR, templateId);
      const itemContext: RuntimeContext = {
        aliases: { ...(context.aliases ?? {}), [alias]: item, $index: index },
      };
      contexts.set(clone, itemContext);
      anchor.after(clone);
      anchor = clone;
      renderElement(clone, itemContext, contexts, rootElement);
    });
  }

  function applyText(element: Element, context: RuntimeContext) {
    const expression = element.getAttribute("x-text");
    if (!expression) return;
    const value = evaluateExpression(state, context, expression);
    element.textContent = value == null ? "" : String(value);
  }

  function applyShow(element: Element, context: RuntimeContext) {
    const expression = element.getAttribute("x-show");
    if (!expression) return;
    (element as HTMLElement).hidden = !isTruthy(
      evaluateExpression(state, context, expression),
    );
  }

  function applyModel(element: Element, context: RuntimeContext) {
    const path = element.getAttribute("x-model");
    if (!path) return;
    const value = getPath(state, context, path);
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = Boolean(value);
      return;
    }
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      element.value = value == null ? "" : String(value);
    }
  }

  function applyBindings(element: Element, context: RuntimeContext) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name;
      if (name === ":class" || name === "x-bind:class") {
        applyClassBinding(state, element, context, attr.value);
        continue;
      }
      const bindName = name.startsWith(":")
        ? name.slice(1)
        : name.startsWith("x-bind:")
          ? name.slice("x-bind:".length)
          : "";
      if (!bindName || bindName === "class") continue;
      if (!isSafeBoundAttribute(bindName)) {
        element.removeAttribute(bindName);
        continue;
      }
      const value = evaluateExpression(state, context, attr.value);
      if (value === false || value == null) {
        element.removeAttribute(bindName);
      } else if (value === true) {
        element.setAttribute(
          bindName,
          bindName.startsWith("data-") ? "true" : "",
        );
      } else {
        const text = String(value);
        if (URL_BOUND_ATTRIBUTES.has(bindName) && !isSafeBoundUrl(text)) {
          element.removeAttribute(bindName);
          continue;
        }
        element.setAttribute(bindName, text);
      }
    }
  }
}

function isSafeBoundAttribute(name: string) {
  const attr = name.toLowerCase();
  if (attr.startsWith("on") || attr === "style" || attr === "srcdoc") {
    return false;
  }
  return (
    attr.startsWith("data-") ||
    attr.startsWith("aria-") ||
    SAFE_BOUND_ATTRIBUTES.has(attr) ||
    URL_BOUND_ATTRIBUTES.has(attr)
  );
}

function isSafeBoundUrl(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (
    compact === "" ||
    compact.startsWith("#") ||
    compact.startsWith("/") ||
    compact.startsWith("./") ||
    compact.startsWith("../")
  ) {
    return true;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(compact)) return true;
  try {
    const url = new URL(compact, window.location.href);
    if (url.protocol === "data:") return SAFE_DATA_IMAGE.test(url.href);
    return SAFE_URL_SCHEMES.has(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}

function parseData(value: string | null): RuntimeRecord {
  if (!value?.trim()) return {};
  const raw = value.trim();
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    // Agent-authored prototype snippets often use Alpine-style object literals.
    // Normalize the safe subset we support into JSON; never execute it.
    try {
      const normalized = raw
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, body: string) =>
          JSON.stringify(body.replace(/\\'/g, "'")),
        );
      const parsed = JSON.parse(normalized);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

function findEventHandler(
  target: HTMLElement,
  island: HTMLElement,
  event: Event,
): { element: HTMLElement; directive: EventDirective } | null {
  let element: HTMLElement | null = target;
  while (element && island.contains(element)) {
    const directive = readEventDirective(element, event);
    if (directive) return { element, directive };
    if (element === island) break;
    element = element.parentElement;
  }
  return null;
}

function readEventDirective(
  element: HTMLElement,
  event: Event,
): EventDirective | null {
  for (const attr of Array.from(element.attributes)) {
    const parsed = parseEventAttribute(attr.name);
    if (!parsed || parsed.type !== event.type) continue;
    if (!eventModifiersMatch(parsed.modifiers, event)) continue;
    return {
      expression: attr.value,
      prevent: parsed.modifiers.includes("prevent"),
    };
  }
  return null;
}

function parseEventAttribute(name: string): {
  type: string;
  modifiers: string[];
} | null {
  const raw = name.startsWith("@")
    ? name.slice(1)
    : name.startsWith("x-on:")
      ? name.slice("x-on:".length)
      : "";
  if (!raw) return null;
  const [type, ...modifiers] = raw.toLowerCase().split(".");
  return { type, modifiers };
}

function eventModifiersMatch(modifiers: string[], event: Event) {
  for (const modifier of modifiers) {
    if (modifier === "prevent") continue;
    if (!(event instanceof KeyboardEvent)) continue;
    const expected = EVENT_KEY_MODIFIERS[modifier];
    if (expected && event.key !== expected) return false;
  }
  return true;
}

function runStatements(
  state: RuntimeRecord,
  context: RuntimeContext,
  expression: string,
) {
  splitTopLevel(expression, ";").forEach((statement) => {
    runStatement(state, context, statement.trim());
  });
}

function runStatement(
  state: RuntimeRecord,
  context: RuntimeContext,
  statement: string,
) {
  if (!statement) return;

  const guarded = splitTopLevel(statement, "&&");
  if (guarded.length > 1) {
    const action = guarded.pop() ?? "";
    if (
      guarded.every((expr) =>
        isTruthy(evaluateExpression(state, context, expr)),
      )
    ) {
      runStatement(state, context, action);
    }
    return;
  }

  const arrayCall = statement.match(
    /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(push|unshift|splice)\((.*)\)$/,
  );
  if (arrayCall) {
    const [, path, method, argsExpression] = arrayCall;
    const target = getPath(state, context, path);
    if (!Array.isArray(target)) return;
    const args = splitTopLevel(argsExpression, ",").map((arg) =>
      evaluateExpression(state, context, arg),
    );
    if (method === "push") target.push(args[0]);
    if (method === "unshift") target.unshift(args[0]);
    if (method === "splice") {
      const start = Number(args[0]);
      const count = Number(args[1]);
      if (Number.isFinite(start))
        target.splice(start, Number.isFinite(count) ? count : 1);
    }
    return;
  }

  const removeCall = statement.match(/^remove\((.+)\)$/);
  if (removeCall) {
    const args = splitTopLevel(removeCall[1], ",");
    const list = evaluateExpression(state, context, args[0]);
    const item = evaluateExpression(state, context, args[1]);
    if (Array.isArray(list)) {
      const index = list.indexOf(item);
      if (index >= 0) list.splice(index, 1);
    }
    return;
  }

  const setAllCall = statement.match(/^setAll\((.+)\)$/);
  if (setAllCall) {
    const args = splitTopLevel(setAllCall[1], ",");
    const list = evaluateExpression(state, context, args[0]);
    const key = evaluateExpression(state, context, args[1]);
    const value = evaluateExpression(state, context, args[2]);
    if (Array.isArray(list) && typeof key === "string") {
      list.forEach((item) => {
        if (isRecord(item)) item[key] = value;
      });
    }
    return;
  }

  const removeWhereCall = statement.match(/^removeWhere\((.+)\)$/);
  if (removeWhereCall) {
    const args = splitTopLevel(removeWhereCall[1], ",");
    const list = evaluateExpression(state, context, args[0]);
    const key = evaluateExpression(state, context, args[1]);
    const value = evaluateExpression(state, context, args[2]);
    if (Array.isArray(list) && typeof key === "string") {
      for (let index = list.length - 1; index >= 0; index--) {
        const item = list[index];
        if (isRecord(item) && item[key] === value) list.splice(index, 1);
      }
    }
    return;
  }

  const assignment = statement.match(/^(.+?)\s*=\s*(.+)$/);
  if (assignment && !/[=!<>]=/.test(assignment[1])) {
    const [, path, valueExpression] = assignment;
    setPath(
      state,
      context,
      path.trim(),
      evaluateExpression(state, context, valueExpression),
    );
  }
}

function evaluateExpression(
  state: RuntimeRecord,
  context: RuntimeContext,
  expression: string,
): unknown {
  const expr = stripOuterParens(expression.trim());
  if (!expr) return "";

  const ors = splitTopLevel(expr, "||");
  if (ors.length > 1) {
    return ors.some((part) =>
      isTruthy(evaluateExpression(state, context, part)),
    );
  }
  const ands = splitTopLevel(expr, "&&");
  if (ands.length > 1) {
    return ands.every((part) =>
      isTruthy(evaluateExpression(state, context, part)),
    );
  }

  for (const operator of ["===", "!==", "==", "!=", ">=", "<=", ">", "<"]) {
    const parts = splitTopLevel(expr, operator);
    if (parts.length === 2) {
      const left = evaluateExpression(state, context, parts[0]);
      const right = evaluateExpression(state, context, parts[1]);
      if (operator === "===" || operator === "==") return left === right;
      if (operator === "!==" || operator === "!=") return left !== right;
      const l = Number(left);
      const r = Number(right);
      if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
      if (operator === ">=") return l >= r;
      if (operator === "<=") return l <= r;
      if (operator === ">") return l > r;
      return l < r;
    }
  }

  if (expr.startsWith("!")) {
    return !isTruthy(evaluateExpression(state, context, expr.slice(1)));
  }
  if (isQuoted(expr)) return expr.slice(1, -1);
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(expr)) return Number(expr);
  const helperCall = expr.match(/^(count|countWhere|remaining)\((.*)\)$/);
  if (helperCall) {
    return evaluateHelperCall(state, context, helperCall[1], helperCall[2]);
  }
  if (expr.startsWith("{") && expr.endsWith("}")) {
    return evaluateObjectExpression(state, context, expr);
  }
  if (expr.startsWith("[") && expr.endsWith("]")) {
    return splitTopLevel(expr.slice(1, -1), ",").map((part) =>
      evaluateExpression(state, context, part),
    );
  }
  return getPath(state, context, expr);
}

function evaluateHelperCall(
  state: RuntimeRecord,
  context: RuntimeContext,
  name: string,
  argsExpression: string,
) {
  const args = splitTopLevel(argsExpression, ",");
  const list = evaluateExpression(state, context, args[0] ?? "");
  if (!Array.isArray(list)) return 0;
  if (name === "count") return list.length;
  const key = evaluateExpression(state, context, args[1] ?? "");
  if (typeof key !== "string") return 0;
  if (name === "remaining") {
    return list.filter((item) => !isRecord(item) || !isTruthy(item[key]))
      .length;
  }
  const expected = evaluateExpression(state, context, args[2] ?? "");
  return list.filter((item) => isRecord(item) && item[key] === expected).length;
}

function evaluateObjectExpression(
  state: RuntimeRecord,
  context: RuntimeContext,
  expression: string,
) {
  const result: RuntimeRecord = {};
  splitTopLevel(expression.slice(1, -1), ",").forEach((entry) => {
    const [keyExpression, valueExpression] = splitFirstTopLevel(entry, ":");
    if (!keyExpression || valueExpression == null) return;
    const key = isQuoted(keyExpression.trim())
      ? keyExpression.trim().slice(1, -1)
      : keyExpression.trim();
    result[key] = evaluateExpression(state, context, valueExpression);
  });
  return result;
}

function getPath(
  state: RuntimeRecord,
  context: RuntimeContext,
  rawPath: string,
): unknown {
  const path = rawPath.trim();
  if (path === "$index") return context.aliases?.$index;
  if (path.endsWith(".length")) {
    const value = getPath(state, context, path.slice(0, -".length".length));
    return Array.isArray(value) || typeof value === "string" ? value.length : 0;
  }
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  let value: unknown =
    context.aliases && parts[0] in context.aliases
      ? context.aliases[parts[0]]
      : state[parts[0]];
  for (const part of parts.slice(1)) {
    if (!isRecord(value)) return undefined;
    value = value[part];
  }
  return value;
}

function setPath(
  state: RuntimeRecord,
  context: RuntimeContext,
  rawPath: string,
  value: unknown,
) {
  const parts = rawPath
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return;
  let target: RuntimeRecord;
  if (context.aliases && parts[0] in context.aliases) {
    const aliasTarget = context.aliases[parts[0]];
    if (!isRecord(aliasTarget)) return;
    target = aliasTarget;
  } else {
    if (!isRecord(state[parts[0]]) && parts.length > 1) state[parts[0]] = {};
    target = state;
  }
  const start = target === state ? 0 : 1;
  for (const part of parts.slice(start, -1)) {
    if (!isRecord(target[part])) target[part] = {};
    target = target[part] as RuntimeRecord;
  }
  target[parts[parts.length - 1]] = value;
}

function applyClassBinding(
  state: RuntimeRecord,
  element: Element,
  context: RuntimeContext,
  expression: string,
) {
  const prior = MANAGED_CLASSES.get(element);
  const classes = new Set(
    (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
  );
  prior?.forEach((className) => classes.delete(className));
  const value = evaluateExpression(state, context, expression);
  const next = new Set<string>();
  if (isRecord(value)) {
    Object.entries(value).forEach(([className, enabled]) => {
      if (isTruthy(enabled)) {
        classes.add(className);
        next.add(className);
      }
    });
  } else if (typeof value === "string" && value) {
    value.split(/\s+/).forEach((className) => {
      classes.add(className);
      next.add(className);
    });
  }
  element.setAttribute("class", Array.from(classes).join(" "));
  MANAGED_CLASSES.set(element, next);
}

function splitFirstTopLevel(value: string, delimiter: string) {
  const parts = splitTopLevel(value, delimiter);
  if (parts.length <= 1) return [value, null] as const;
  return [parts[0], parts.slice(1).join(delimiter)] as const;
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth++;
    if (char === "}" || char === "]" || char === ")") depth--;
    if (
      depth === 0 &&
      value.slice(index, index + delimiter.length) === delimiter
    ) {
      parts.push(value.slice(start, index).trim());
      index += delimiter.length - 1;
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function stripOuterParens(value: string): string {
  if (!value.startsWith("(") || !value.endsWith(")")) return value;
  const inner = value.slice(1, -1);
  return splitTopLevel(inner, ",").join(",") === inner ? inner.trim() : value;
}

function isQuoted(value: string) {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  );
}

function isTruthy(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function isRecord(value: unknown): value is RuntimeRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNestedRuntimeRoot(element: Element) {
  return element.hasAttribute("x-data");
}

function isInsideNestedIsland(target: HTMLElement, island: HTMLElement) {
  const closest = target.closest("[x-data]");
  return Boolean(closest && closest !== island);
}

function ensureTemplateId(template: HTMLElement) {
  const existing = template.getAttribute(TEMPLATE_ID_ATTR);
  if (existing) return existing;
  const id = `proto-for-${Math.random().toString(36).slice(2)}`;
  template.setAttribute(TEMPLATE_ID_ATTR, id);
  return id;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
