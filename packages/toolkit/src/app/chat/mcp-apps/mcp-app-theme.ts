export function resolveMcpAppTheme(
  root: Pick<HTMLElement, "classList" | "getAttribute">,
  readSystemTheme: () => boolean,
): "dark" | "light" {
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";

  const dataTheme = root.getAttribute("data-theme");
  if (dataTheme === "dark" || dataTheme === "light") return dataTheme;
  return readSystemTheme() ? "dark" : "light";
}
