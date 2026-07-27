import { redirect, type LoaderFunctionArgs } from "react-router";

// Legacy redirect: brand containers now live in the unified Library workspace.
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/library${url.search}`);
}

export default function LibrariesRedirect() {
  return null;
}
