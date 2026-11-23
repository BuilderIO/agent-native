import {
  captureShellSnapshot,
  shellTags,
  type ShellSemanticSnapshot,
} from "@agent-native/toolkit/app-shell/shell-testing";

export function observeNavigationLinks(root: ParentNode) {
  const surface = document.createElement("div");
  for (const link of root.querySelectorAll("a"))
    surface.append(link.cloneNode(true));
  for (const element of surface.querySelectorAll("a")) {
    const href = element.getAttribute("href");
    if (!href) throw new Error("Missing observed destination");
    for (const [name, value] of Object.entries(
      shellTags(
        { id: href, entityKey: element.textContent?.trim() ?? "" },
        "sidebar.item",
        "rail",
      ),
    ))
      element.setAttribute(name, value);
  }
  return captureShellSnapshot(surface, {
    visible: () => true,
    observe(identity, elements, order): ShellSemanticSnapshot {
      const element = elements[0];
      if (!element) throw new Error("Missing observed control");
      return {
        ...identity,
        part: "sidebar.item",
        containerId: "rail",
        order,
        present: true,
        family: "a",
        role: element.getAttribute("role"),
        expanded: null,
        name: element.textContent?.trim() ?? "",
        value: null,
        choices: [],
        enabled: true,
        selected: element.getAttribute("aria-current") === "page",
        checked: null,
        shortcut: null,
        badge: null,
        effect: {
          kind: "route",
          target: element.getAttribute("href"),
          result: null,
        },
        read: { status: "ready", message: null, recovery: null },
        action: { pending: false, error: null, recovery: null },
        keyboard: {
          reachable: element.getAttribute("tabindex") !== "-1",
          operable: true,
        },
      };
    },
  });
}
