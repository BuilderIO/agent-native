import { Fragment } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function ShortcutKeycaps({ shortcut }: { shortcut: string }) {
  const combos = shortcut.split(" / ");
  const keyGroups = combos.map((combo) => {
    if (combo === "Fn" || combo === "Custom") return [combo];
    if (combo.includes(" ")) return combo.split(" ").filter(Boolean);

    const keys: string[] = [];
    let remainder = combo;
    for (const modifier of ["⌘", "⌃", "⌥", "⇧"]) {
      while (remainder.startsWith(modifier)) {
        keys.push(modifier);
        remainder = remainder.slice(modifier.length);
      }
    }
    if (remainder) keys.push(remainder);
    return keys;
  });

  return (
    <span className="bottom-shortcut">
      <span className="sr-only">Shortcut: {shortcut}</span>
      {keyGroups.map((keys, groupIndex) => (
        <Fragment key={`${shortcut}-${groupIndex}`}>
          {groupIndex > 0 ? (
            <span className="bottom-shortcut-separator" aria-hidden="true">
              /
            </span>
          ) : null}
          <KbdGroup aria-hidden="true">
            {keys.map((key, keyIndex) => (
              <Kbd key={`${key}-${keyIndex}`}>{key}</Kbd>
            ))}
          </KbdGroup>
        </Fragment>
      ))}
    </span>
  );
}
