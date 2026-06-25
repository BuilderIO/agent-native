import { redirect, type LoaderFunctionArgs } from "react-router";

// Legacy redirect: a single brand container's detail page moved from
// /library/:id to /brand-kits/:id.
export function loader({ params, url }: LoaderFunctionArgs) {
  return redirect(`/brand-kits/${params.id}${url.search}`);
}

export default function LibraryDetailRedirect() {
  return null;
}
