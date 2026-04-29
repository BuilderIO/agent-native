import { Outlet } from "react-router";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Booking Links — Calendar" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function BookingLinksLayout() {
  return <Outlet />;
}
