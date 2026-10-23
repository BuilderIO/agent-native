import { useTheme } from "next-themes";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";

type EditorOverlayTheme = "dark" | "light";

const EditorOverlayThemeContext = createContext<EditorOverlayTheme>("dark");

export function EditorOverlayThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const theme: EditorOverlayTheme =
    mounted && resolvedTheme === "light" ? "light" : "dark";

  return (
    <EditorOverlayThemeContext.Provider value={theme}>
      <div className={cn(theme, "contents")}>{children}</div>
    </EditorOverlayThemeContext.Provider>
  );
}

export function useEditorOverlayThemeClassName(className?: string) {
  return cn(useContext(EditorOverlayThemeContext), className);
}
