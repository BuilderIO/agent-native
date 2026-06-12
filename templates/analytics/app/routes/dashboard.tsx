import { redirect, type LoaderFunctionArgs } from "react-router";

function target(request: Request): string {
  const url = new URL(request.url);
  return `/${url.search}${url.hash}`;
}

export function loader({ request }: LoaderFunctionArgs) {
  throw redirect(target(request));
}

export function clientLoader({ request }: LoaderFunctionArgs) {
  throw redirect(target(request));
}

export default function DashboardAliasRoute() {
  return null;
}
