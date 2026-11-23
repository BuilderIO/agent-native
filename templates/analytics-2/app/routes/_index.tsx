import { signInLandingLoader } from "@agent-native/core/client/sign-in-landing";
import { Navigate, useLocation } from "react-router";

export function loader({ request }: { request: Request }) {
  return signInLandingLoader("/home", request);
}

export default function IndexRoute() {
  const location = useLocation();
  return <Navigate to={"/home" + location.search + location.hash} replace />;
}
