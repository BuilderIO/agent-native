// Re-export React Router utilities for framework mode.
// Import from "@agent-native/core/router" in route modules.

export {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useParams,
  useLoaderData,
  useActionData,
  useLocation,
  useSearchParams,
  redirect,
  data,
  Form,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

export { HydratedRouter } from "react-router/dom";
