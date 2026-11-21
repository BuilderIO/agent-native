import { IconPlus, IconX } from "@tabler/icons-react";
import { Link } from "react-router";

import {
  Button,
  IconButtonLink,
  ButtonLink,
  IconButton,
} from "@/components/ui/button";

export function Actions({ onSave }: { onSave: () => void }) {
  return (
    <div>
      <Button onClick={onSave}>Save</Button>
      <Button color="danger">Delete</Button>
      <Button variant="surface" color="gray">
        Outline
      </Button>
      <Button variant="surface" color="danger">
        Remove
      </Button>
      <Button variant="soft" color="gray">
        Secondary
      </Button>
      <Button variant="ghost" color="gray">
        Ghost
      </Button>
      <Button variant="ghost" color="gray">
        Inset
      </Button>
      <IconButton variant="ghost" color="gray" aria-label="Add">
        <IconPlus />
      </IconButton>
      <IconButton variant="ghost" color="gray" title="Close">
        <IconX />
      </IconButton>
      <IconButton>
        <IconX />
      </IconButton>
      <ButtonLink
        variant="surface"
        color="gray"
        render={<Link to="/designs" className="gap-2" />}
      >
        Open designs
      </ButtonLink>
      <Button render={<button type="button" />}>Native</Button>
      <ButtonLink
        variant="ghost"
        color="gray"
        href="https://example.com"
        target="_blank"
        rel="noreferrer"
      >
        Docs
      </ButtonLink>
      <IconButtonLink
        variant="ghost"
        color="gray"
        render={<Link to="/help" aria-label="Help" />}
      >
        <IconX />
      </IconButtonLink>
      <form>
        <Button type="submit">Submit</Button>
        <Button type="button">Not a submit</Button>
      </form>
    </div>
  );
}
