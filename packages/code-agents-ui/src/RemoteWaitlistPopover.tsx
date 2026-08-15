import { IconLoader2 } from "@tabler/icons-react";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import type {
  CodeAgentRemoteWaitlistRequest,
  CodeAgentRemoteWaitlistResult,
} from "./types.js";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover.js";

const REMOTE_WAITLIST_URL =
  "https://agent-native.com/_agent-native/builder/branch-waitlist";

const DEFAULT_JOINED_MESSAGE =
  "You're on the waitlist. We'll email you when remote access opens.";

async function submitRemoteWaitlist(
  request: CodeAgentRemoteWaitlistRequest,
): Promise<CodeAgentRemoteWaitlistResult> {
  const response = await fetch(REMOTE_WAITLIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  let payload: {
    error?: unknown;
    message?: unknown;
  } = {};
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as typeof payload;
      }
    } catch (error) {
      console.warn(
        "[code-agents] Remote waitlist returned invalid JSON:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      error:
        typeof payload.error === "string"
          ? payload.error
          : "Couldn't join the waitlist. Please try again.",
    };
  }
  return {
    ok: true,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
}

export function RemoteWaitlistPopover({
  children,
  open,
  onOpenChange,
  submit,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submit?: (
    request: CodeAgentRemoteWaitlistRequest,
  ) => Promise<CodeAgentRemoteWaitlistResult>;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className="code-agents-remote-waitlist-anchor">{children}</div>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={12}
        collisionPadding={16}
        className="code-agents-remote-waitlist-content"
      >
        <RemoteWaitlistContent submit={submit} />
      </PopoverContent>
    </Popover>
  );
}

function RemoteWaitlistContent({
  submit,
}: {
  submit?: (
    request: CodeAgentRemoteWaitlistRequest,
  ) => Promise<CodeAgentRemoteWaitlistResult>;
}) {
  const [email, setEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setError("Enter a valid email address.");
        return;
      }

      setJoining(true);
      setError(null);
      try {
        const request: CodeAgentRemoteWaitlistRequest = {
          email: trimmed,
          pageUrl:
            typeof window === "undefined" ? undefined : window.location.href,
          source: "desktop_code_agents",
          useCase: "desktop_remote_code_agent_waitlist",
        };
        const result = await (submit ?? submitRemoteWaitlist)(request);
        if (!result.ok) {
          setError(
            result.error ?? "Couldn't join the waitlist. Please try again.",
          );
          return;
        }
        setJoined(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't join the waitlist. Please try again.",
        );
      } finally {
        setJoining(false);
      }
    },
    [email, submit],
  );

  return (
    <div className="code-agents-remote-waitlist">
      <div>
        <h3 className="code-agents-remote-waitlist__title">
          Join the waitlist
        </h3>
        <p className="code-agents-remote-waitlist__body">
          Rapidly generate agent-native apps in the cloud. Join the waitlist for
          early access.
        </p>
      </div>

      {joined ? (
        <p className="code-agents-remote-waitlist__success">
          {DEFAULT_JOINED_MESSAGE}
        </p>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label
            className="code-agents-remote-waitlist__label"
            htmlFor="code-agents-remote-email"
          >
            Email
          </label>
          <input
            id="code-agents-remote-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            className="code-agents-remote-waitlist__input"
          />
          {error ? (
            <p className="code-agents-remote-waitlist__error">{error}</p>
          ) : null}
          <button
            type="submit"
            className="code-agents-remote-waitlist__submit"
            disabled={joining}
          >
            {joining ? (
              <>
                <IconLoader2
                  size={15}
                  className="code-agents-remote-waitlist__spinner"
                />
                Joining...
              </>
            ) : (
              "Join waitlist"
            )}
          </button>
        </form>
      )}
    </div>
  );
}
