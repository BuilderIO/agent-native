import { useState } from "react";
import { useJiraAuthUrl } from "@/hooks/use-jira-auth";
import { ExternalLink, Copy, Check, ArrowRight } from "lucide-react";

export function JiraConnectBanner() {
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);
  const { data: authData } = useJiraAuthUrl(step >= 5);

  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/atlassian/callback`
      : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">📋</div>
          <h1 className="text-xl font-semibold text-foreground">
            Connect to Jira
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up your Atlassian OAuth app to get started
          </p>
        </div>

        <div className="space-y-4">
          {/* Step 1 */}
          <StepCard
            step={1}
            current={step}
            title="Create an OAuth 2.0 app"
            onActivate={() => setStep(1)}
          >
            <p className="text-[13px] text-muted-foreground">
              Go to the{" "}
              <a
                href="https://developer.atlassian.com/console/myapps/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                Atlassian Developer Console
                <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>{" "}
              and create a new OAuth 2.0 (3LO) integration.
            </p>
            <button
              onClick={() => setStep(2)}
              className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:underline"
            >
              Next <ArrowRight className="h-3 w-3" />
            </button>
          </StepCard>

          {/* Step 2 */}
          <StepCard
            step={2}
            current={step}
            title="Add required permissions"
            onActivate={() => setStep(2)}
          >
            <p className="text-[13px] text-muted-foreground">
              Under <strong>Permissions</strong>, add these scopes:
            </p>
            <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
              <li>
                <strong>Jira API</strong>: read:jira-work, write:jira-work,
                read:jira-user
              </li>
            </ul>
            <button
              onClick={() => setStep(3)}
              className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:underline"
            >
              Next <ArrowRight className="h-3 w-3" />
            </button>
          </StepCard>

          {/* Step 3 */}
          <StepCard
            step={3}
            current={step}
            title="Set callback URL"
            onActivate={() => setStep(3)}
          >
            <p className="text-[13px] text-muted-foreground">
              Under <strong>Authorization &rarr; OAuth 2.0 (3LO)</strong>, set
              the callback URL:
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
              <code className="flex-1 text-[12px] text-foreground">
                {callbackUrl}
              </code>
              <button
                onClick={handleCopy}
                className="text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <button
              onClick={() => setStep(4)}
              className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:underline"
            >
              Next <ArrowRight className="h-3 w-3" />
            </button>
          </StepCard>

          {/* Step 4 */}
          <StepCard
            step={4}
            current={step}
            title="Set environment variables"
            onActivate={() => setStep(4)}
          >
            <p className="text-[13px] text-muted-foreground">
              Copy the <strong>Client ID</strong> and <strong>Secret</strong>{" "}
              from your app&apos;s Settings page. Add them to your{" "}
              <code className="text-[12px]">.env</code> file:
            </p>
            <pre className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-[12px] text-foreground">
              {`ATLASSIAN_CLIENT_ID=your_client_id\nATLASSIAN_CLIENT_SECRET=your_secret`}
            </pre>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Restart the dev server after adding these variables.
            </p>
            <button
              onClick={() => setStep(5)}
              className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:underline"
            >
              Next <ArrowRight className="h-3 w-3" />
            </button>
          </StepCard>

          {/* Step 5 */}
          <StepCard
            step={5}
            current={step}
            title="Connect your account"
            onActivate={() => setStep(5)}
          >
            {authData?.url ? (
              <a
                href={authData.url}
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Sign in with Atlassian
              </a>
            ) : authData?.error ? (
              <p className="text-[13px] text-destructive">
                {authData.message ||
                  "OAuth credentials not configured. Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET and restart."}
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">Loading...</p>
            )}
          </StepCard>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  current,
  title,
  onActivate,
  children,
}: {
  step: number;
  current: number;
  title: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  const isActive = step === current;
  const isDone = step < current;

  return (
    <div
      className={`rounded-lg border p-4 ${
        isActive
          ? "border-border bg-card"
          : isDone
            ? "border-border/50 bg-muted/30"
            : "border-border/30 bg-transparent"
      }`}
    >
      <button
        onClick={onActivate}
        className="flex w-full items-center gap-3 text-left"
      >
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
            isDone
              ? "bg-green-500/15 text-green-500"
              : isActive
                ? "bg-primary/10 text-foreground"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {isDone ? "✓" : step}
        </div>
        <span
          className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}
        >
          {title}
        </span>
      </button>
      {isActive && <div className="mt-3 pl-9">{children}</div>}
    </div>
  );
}
