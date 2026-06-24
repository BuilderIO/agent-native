import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/library${url.search}`);
}

export default function BrandKitsIndexRedirect() {
  return null;
}
