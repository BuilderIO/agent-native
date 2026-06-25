import { redirect, type LoaderFunctionArgs } from "react-router";

// Legacy redirect: brand containers moved from "Libraries" (/libraries) to
// "Brand Kits" (/brand-kits).
export function loader({ url }: LoaderFunctionArgs) {
  return redirect(`/brand-kits${url.search}`);
}

export default function LibrariesRedirect() {
  return null;
}
