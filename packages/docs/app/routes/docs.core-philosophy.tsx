import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export function loader(_args: LoaderFunctionArgs) {
  return redirect("/docs/key-concepts");
}

export default function CorePhilosophy() {
  return null;
}
