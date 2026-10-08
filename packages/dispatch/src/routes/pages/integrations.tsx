import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  const target = new URL(request.url);
  target.pathname = target.pathname.replace(
    /\/integrations\/?$/,
    "/settings/integrations",
  );
  return redirect(target.toString());
}
