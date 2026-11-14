import { createContext } from "react";

/**
 * Whether the editor around a node view draws Mermaid code blocks. Previews of
 * other pages inside it follow suit, so a public page draws none anywhere.
 */
export const DrawDiagramsContext = createContext(true);
