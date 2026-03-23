import { redirect } from "react-router";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Mail" }];
}

export function clientLoader() {
  throw redirect("/inbox");
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner />
    </div>
  );
}

export default function IndexRoute() {
  // This should never render — clientLoader redirects to /inbox
  return null;
}
