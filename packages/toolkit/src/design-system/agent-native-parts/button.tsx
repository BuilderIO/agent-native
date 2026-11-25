import type { ModelRow } from "@agent-native/design-system/model";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";

import { Button, ButtonLink } from "../../ui/base-ui/button.js";
import { Spinner } from "../../ui/spinner.js";
import {
  type PartComponent,
  type PartProps,
  rowAttributes,
  useRowEffect,
} from "../parts.js";
import { Glyph } from "./glyph.js";

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function DestinationLink({
  row,
  to,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  row: ModelRow;
  to: string;
  children?: ReactNode;
}) {
  const run = useRowEffect(row);
  const inRouter = useInRouterContext();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isModifiedClick(event)) return;
    event.preventDefault();
    run?.();
  };
  return inRouter ? (
    <Link {...props} to={to} onClick={onClick}>
      {children}
    </Link>
  ) : (
    <a {...props} href={to} onClick={onClick}>
      {children}
    </a>
  );
}

const LOOK = { variant: "surface", color: "gray" } as const;

function ButtonPart({ row }: PartProps) {
  const run = useRowEffect(row);
  const pending = row.state?.pending === true;
  const label = (
    <>
      {row.label}
      {row.icon ? <Glyph icon={row.icon} /> : null}
    </>
  );
  if (row.effect?.kind === "navigate") {
    return (
      <ButtonLink
        {...rowAttributes(row)}
        {...LOOK}
        render={<DestinationLink row={row} to={row.effect.to} />}
      >
        {pending ? <Spinner aria-hidden="true" /> : null}
        {label}
      </ButtonLink>
    );
  }
  return (
    <Button
      {...rowAttributes(row)}
      {...LOOK}
      type="button"
      loading={pending}
      disabled={row.state?.disabled === true}
      onClick={() => run?.()}
    >
      {label}
    </Button>
  );
}

/** Toolkit's button part, keyed by part reference. */
export const BUTTON_PARTS = {
  button: ButtonPart,
} as const satisfies Record<string, PartComponent>;
