import { IconCheck } from "@tabler/icons-react";

import { MenuButton, MenuHeading } from "./primitives";
import { useThemePreference, type ThemePreference } from "./theme-preference";

function labelForSystem(theme: "light" | "dark") {
  return `System (${theme === "dark" ? "Dark" : "Light"})`;
}

export function ThemeMenuItems() {
  const { preference, setPreference, systemTheme } = useThemePreference();

  const rows: Array<{ value: ThemePreference; label: string }> = [
    { value: "system", label: labelForSystem(systemTheme) },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <>
      <MenuHeading>Theme</MenuHeading>
      {rows.map((row) => (
        <MenuButton
          key={row.value}
          label={row.label}
          active={preference === row.value}
          trailing={preference === row.value ? <IconCheck size={16} /> : null}
          onSelect={() => setPreference(row.value)}
        />
      ))}
    </>
  );
}
