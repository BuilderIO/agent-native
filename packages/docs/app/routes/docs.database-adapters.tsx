import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export function loader(_args: LoaderFunctionArgs) {
  return redirect("/docs/file-sync");
}

export default function DatabaseAdapters() {
  return null;
}
