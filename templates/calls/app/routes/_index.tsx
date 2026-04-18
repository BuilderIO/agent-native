import { useEffect } from "react";
import { useNavigate } from "react-router";
import { DefaultSpinner } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Calls" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <DefaultSpinner />
    </div>
  );
}

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
