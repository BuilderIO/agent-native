import { Link } from "react-router";
import { IconMail } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center">
        <IconMail className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-foreground">404</h1>
        <p className="mt-1 text-sm text-muted-foreground">Page not found</p>
        <Button asChild className="mt-6" size="sm">
          <Link to="/inbox">Go to Inbox</Link>
        </Button>
      </div>
    </div>
  );
}
