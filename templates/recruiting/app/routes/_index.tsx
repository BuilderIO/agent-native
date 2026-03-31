import { useEffect } from "react";
import { useNavigate } from "react-router";

export function meta() {
  return [{ title: "Recruiting" }];
}

export default function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/dashboard", { replace: true });
  }, [navigate]);
  return null;
}
