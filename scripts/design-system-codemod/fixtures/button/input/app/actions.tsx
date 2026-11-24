import { IconPlus, IconX } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function Actions({ onSave }: { onSave: () => void }) {
  return (
    <div>
      <Button onClick={onSave}>Save</Button>
      <Button variant="destructive" size="sm">
        Delete
      </Button>
      <Button variant="outline" size="xs">
        Outline
      </Button>
      <Button variant="outline-destructive">Remove</Button>
      <Button variant="secondary" size="lg">
        Secondary
      </Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="ghost-inset" size="sm">
        Inset
      </Button>
      <Button variant="ghost" size="icon" aria-label="Add">
        <IconPlus />
      </Button>
      <Button variant="ghost" size="icon-xs" title="Close">
        <IconX />
      </Button>
      <Button size="icon-sm">
        <IconX />
      </Button>
      <Button asChild variant="outline">
        <Link to="/designs" className="gap-2">
          Open designs
        </Link>
      </Button>
      <Button asChild>
        <button type="button">Native</button>
      </Button>
      <Button asChild variant="ghost">
        <a href="https://example.com" target="_blank" rel="noreferrer">
          Docs
        </a>
      </Button>
      <Button asChild size="icon-sm" variant="ghost">
        <Link to="/help" aria-label="Help">
          <IconX />
        </Link>
      </Button>
      <form>
        <Button>Submit</Button>
        <Button type="button">Not a submit</Button>
      </form>
    </div>
  );
}
