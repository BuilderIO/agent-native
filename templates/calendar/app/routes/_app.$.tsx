import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: "Not Found - Calendar" }];
}

export default function AppCatchAllRoute() {
  return <NotFound />;
}
