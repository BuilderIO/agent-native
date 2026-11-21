import { MOTION } from "@agent-native/design-system";
import { IconInfoCircle, IconPlayerPlay } from "@tabler/icons-react";
import * as React from "react";

import { Button } from "../../src/ui/base-ui/button.js";
import {
  Callout,
  CalloutIcon,
  CalloutText,
} from "../../src/ui/base-ui/callout.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../src/ui/base-ui/segmented-control.js";
import { useResolved, useTokenUsage } from "./live.js";
import {
  Cell,
  Code,
  Page,
  Prose,
  Row,
  Section,
  Table,
  TokenValue,
  UsageNote,
  UsedBy,
} from "./page.js";

const TOKENS = Object.keys(MOTION);
const DURATIONS = TOKENS.filter((token) => token.startsWith("--duration-"));
const EASINGS = TOKENS.filter((token) => token.startsWith("--ease-"));

const DOT = "var(--size-3)";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
  );
}

function TokenTable({
  tokens,
  caption,
}: {
  tokens: string[];
  caption: string;
}) {
  const values = useResolved(tokens, "raw");
  const usage = useTokenUsage();
  return (
    <>
      <Table
        caption={caption}
        columns={[{ label: "Token" }, { label: "Used by" }]}
      >
        {tokens.map((token) => (
          <Row key={token}>
            <Cell header>
              <TokenValue token={token} resolved={values.get(token)} />
            </Cell>
            <Cell>
              <UsedBy usage={usage} token={token} />
            </Cell>
          </Row>
        ))}
      </Table>
      <UsageNote usage={usage} />
    </>
  );
}

function Track({
  label,
  duration,
  easing,
  moved,
  reduced,
}: {
  label: string;
  duration: string;
  easing: string;
  moved: boolean;
  reduced: boolean;
}) {
  return (
    <li className="flex items-center gap-4">
      <span className="w-36 shrink-0">
        <Code>{label}</Code>
      </span>
      <span
        className="relative flex-1 overflow-hidden rounded-pill bg-gray-a3"
        style={{ height: DOT }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 transition-transform motion-reduce:transition-none"
          style={{
            transform: moved
              ? `translateX(calc(100% - ${DOT}))`
              : "translateX(0)",
            transitionDuration: reduced ? "0s" : `var(${duration})`,
            transitionTimingFunction: `var(${easing})`,
          }}
        >
          <span
            className="block rounded-pill bg-brand-9"
            style={{ width: DOT, height: DOT }}
          />
        </span>
      </span>
    </li>
  );
}

function Demo() {
  const reduced = useReducedMotion();
  const [moved, setMoved] = React.useState(false);
  const [easing, setEasing] = React.useState(EASINGS[0] ?? "");
  const [duration, setDuration] = React.useState(DURATIONS.at(-2) ?? "");
  return (
    <div className="flex flex-col gap-4">
      {reduced ? (
        <Callout color="info">
          <CalloutIcon>
            <IconInfoCircle />
          </CalloutIcon>
          <CalloutText>
            Your system asks for reduced motion, so the demo jumps to its end
            without moving.
          </CalloutText>
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setMoved((value) => !value)}>
          <IconPlayerPlay />
          {moved ? "Reverse" : "Play"}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-2 font-medium text-fg">Durations</h3>
        <SegmentedControl
          aria-label="Easing for the durations"
          value={easing}
          onValueChange={setEasing}
          size="sm"
          className="self-start"
        >
          {EASINGS.map((token) => (
            <SegmentedControlItem key={token} value={token}>
              {token.replace("--ease-", "")}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <ul className="flex flex-col gap-2">
          {DURATIONS.map((token) => (
            <Track
              key={token}
              label={token}
              duration={token}
              easing={easing}
              moved={moved}
              reduced={reduced}
            />
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-2 font-medium text-fg">Easings</h3>
        <SegmentedControl
          aria-label="Duration for the easings"
          value={duration}
          onValueChange={setDuration}
          size="sm"
          className="self-start"
        >
          {DURATIONS.map((token) => (
            <SegmentedControlItem key={token} value={token}>
              {token.replace("--duration-", "")}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <ul className="flex flex-col gap-2">
          {EASINGS.map((token) => (
            <Track
              key={token}
              label={token}
              duration={duration}
              easing={token}
              moved={moved}
              reduced={reduced}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MotionPage() {
  return (
    <Page
      title="Motion"
      intro={`${DURATIONS.length} durations and ${EASINGS.length} easings. Small changes move fast and large surfaces take longer; elements enter decelerating and leave accelerating.`}
    >
      <Section title="Demo">
        <Demo />
      </Section>
      <Section title="Durations">
        <TokenTable tokens={DURATIONS} caption="Durations" />
      </Section>
      <Section title="Easings">
        <Prose>
          Use <Code>--ease-standard</Code> for movement within the page,{" "}
          <Code>--ease-enter</Code> for what appears and{" "}
          <Code>--ease-exit</Code> for what leaves.
        </Prose>
        <TokenTable tokens={EASINGS} caption="Easings" />
      </Section>
    </Page>
  );
}
