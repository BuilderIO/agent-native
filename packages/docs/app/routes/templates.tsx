import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { Outlet, redirect, type LoaderFunctionArgs } from "react-router";

export default function TemplatesLayout() {
  return <Outlet />;
}

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/templates(?=\/|$)/, "/apps");
  throw withSsrHtmlContentType(redirect(`${url.pathname}${url.search}`, 301), {
    varyByQuery: true,
  });
}
