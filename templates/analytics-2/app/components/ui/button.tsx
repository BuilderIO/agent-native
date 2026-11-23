// Thin app-local re-export: the design system lives in the toolkit, and the
// list shell imports it through this path. Restores the module the scaffold
// rebuild removed while its consumers stayed.
export {
  Button,
  ButtonBase,
  buttonVariants,
} from "@agent-native/toolkit/ui/button";
export type { ButtonProps } from "@agent-native/toolkit/ui/button";
