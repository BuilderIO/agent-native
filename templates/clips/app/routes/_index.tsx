import { useEffect } from "react";
import { useNavigate } from "react-router";
import { DefaultSpinner } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Clips" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <DefaultSpinner />
    </div>
  );
}

// The root route redirects to /library — the Library is the default landing
// view. Everything else hangs off the pathless _app layout so the sidebar +
// agent chat persist across navigations.
export default function IndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/library", { replace: true });
  }, [navigate]);

  return (
    <div className="flex items-center justify-center h-screen w-full">
      <DefaultSpinner />
    </div>
  );
}
