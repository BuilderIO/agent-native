import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { sendToAgentChat } from "@agent-native/core";
import {
  useIntegration,
  useAllIntegrations,
  useHubSpotContact,
  useGongCalls,
  usePylonContact,
} from "@/hooks/use-integrations";
import { useApolloPerson } from "@/hooks/use-apollo";
import type { ApolloPersonResult } from "@shared/types";

// ─── Integration definitions ────────────────────────────────────────────────

type ProviderId = "apollo" | "hubspot" | "gong" | "pylon";

interface IntegrationDef {
  id: ProviderId;
  name: string;
  description: string;
  keyPlaceholder: string;
  helpUrl: string;
  helpSteps: string[];
  logo: React.ReactNode;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "apollo",
    name: "Apollo",
    description: "Contact enrichment & company data",
    keyPlaceholder: "Apollo API key...",
    helpUrl: "https://app.apollo.io/#/settings/integrations/api",
    helpSteps: [
      "Log in to Apollo.io",
      "Go to Settings > Integrations > API",
      'Click "Connect" to generate a key',
    ],
    logo: (
      <svg
        viewBox="0 0 36 36"
        className="h-full w-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M19.5993 0.0862365L19.605 13.2568C19.6058 15.3375 17.4222 16.6715 15.6079 15.6986L2.58376 8.7153C3.57706 7.05795 4.82616 5.57609 6.27427 4.32386L16.489 13.8945C17.0303 14.4015 17.8835 13.8518 17.6605 13.1398L13.6992 0.493553C15.0326 0.17147 16.4233 0 17.8536 0C18.4428 0 19.0248 0.0296814 19.5993 0.0862365Z"
          fill="#F8FF2C"
        />
        <path
          d="M16.0635 36.1087L16.0578 23.0046C16.057 20.9239 18.2407 19.5898 20.0549 20.5627L33.0838 27.5486C32.0838 29.2016 30.8289 30.6786 29.3751 31.925L19.1738 22.3668C18.6326 21.8598 17.7793 22.4095 18.0023 23.1215L21.9486 35.72C20.6338 36.0329 19.263 36.1989 17.8539 36.1989C17.2497 36.1989 16.6523 36.1683 16.0635 36.1087Z"
          fill="#F8FF2C"
        />
        <path
          d="M22.0105 16.77L31.4705 6.39392C30.2362 4.92008 28.7742 3.6486 27.1384 2.63702L20.2306 15.8767C19.2709 17.716 20.5871 19.9298 22.6396 19.9288L35.6183 19.923C35.6775 19.3234 35.7082 18.7151 35.7082 18.0996C35.7082 16.6683 35.5436 15.2761 35.2338 13.9406L22.7549 17.9576C22.0526 18.1837 21.5103 17.3187 22.0105 16.77Z"
          fill="#F8FF2C"
        />
        <path
          d="M0.0842758 16.3383L13.0237 16.3325C15.0764 16.3317 16.3923 18.5454 15.4327 20.3846L8.56047 33.5561C6.93095 32.547 5.47394 31.2801 4.24344 29.8121L13.653 19.4914C14.1531 18.9427 13.6107 18.0777 12.9084 18.3037L0.485078 22.3029C0.168551 20.954 0 19.5467 0 18.0994C0 17.5051 0.0290814 16.9177 0.0842758 16.3383Z"
          fill="#F8FF2C"
        />
      </svg>
    ),
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM contacts, deals & tickets",
    keyPlaceholder: "HubSpot private app token...",
    helpUrl: "https://developers.hubspot.com/docs/api/private-apps",
    helpSteps: [
      "Go to HubSpot > Settings > Integrations > Private Apps",
      "Create a private app with CRM scopes",
      "Copy the access token",
    ],
    logo: (
      <svg
        viewBox="0 0 489 512"
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill="#FF7A59"
          fillRule="nonzero"
          d="M375.25 168.45V107.5c16.43-7.68 26.97-24.15 27.08-42.29V63.8c0-25.95-21.05-46.99-47-46.99h-1.37c-25.95 0-46.99 21.04-46.99 46.99v1.41a46.985 46.985 0 0027.29 42.3v60.94c-23.13 3.53-44.98 13.18-63.19 27.84L103.88 66.16c1.19-4.29 1.83-8.73 1.89-13.17v-.11C105.77 23.68 82.09 0 52.88 0 23.68 0 0 23.68 0 52.88c0 29.18 23.64 52.85 52.81 52.89 9.17-.08 18.16-2.59 26.06-7.23l164.62 128.07a133.501 133.501 0 00-22.16 73.61c0 27.39 8.46 54.17 24.18 76.58l-50.06 50.06a43.926 43.926 0 00-12.43-1.81c-23.96 0-43.38 19.42-43.38 43.37 0 23.96 19.42 43.38 43.38 43.38 23.95 0 43.37-19.42 43.37-43.38v-.13a41.81 41.81 0 00-2.02-12.5l49.52-49.56a133.687 133.687 0 0081.54 27.78c73.76 0 133.57-59.81 133.57-133.57 0-66.05-48.3-122.2-113.61-132.06l-.14.07zm-20.39 200.4c-36.79-1.52-65.85-31.79-65.85-68.62 0-35.43 26.97-65.06 62.23-68.38h3.62c35.8 2.73 63.46 32.58 63.46 68.48 0 35.91-27.66 65.76-63.45 68.48l-.01.04z"
        />
      </svg>
    ),
  },
  {
    id: "gong",
    name: "Gong",
    description: "Recent calls & conversation intelligence",
    keyPlaceholder: "Gong API key or access_key:secret...",
    helpUrl: "https://app.gong.io/company/api",
    helpSteps: [
      "Go to Gong > Company Settings > API",
      "Generate API credentials",
      "Copy the access key (or key:secret)",
    ],
    logo: (
      <svg
        viewBox="0 0 42 42"
        className="h-full w-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M36.9813 18.0568H25.8482C25.2335 18.0568 24.7554 18.7393 24.9603 19.2853L27.6241 26.1786C27.7607 26.4516 27.4875 26.7928 27.1459 26.7928L23.7309 26.5881C23.5943 26.5881 23.4577 26.6563 23.3211 26.7928L20.7256 30.5466C20.589 30.7513 20.3158 30.8196 20.0426 30.6831L16.0811 28.0213C15.9445 27.8848 15.7396 27.8848 15.5347 28.0213L10.0706 31.7068C9.72913 31.9798 9.25102 31.6386 9.38762 31.2291L10.9586 25.7691C11.0269 25.5643 10.8903 25.2913 10.6853 25.2231L7.8167 24.0628C7.54349 23.9263 7.40689 23.5851 7.61179 23.3803L10.1389 20.2408C10.2755 20.1043 10.2755 19.8313 10.1389 19.6948L8.0216 16.6236C7.8167 16.3506 8.0216 15.9411 8.36311 15.9411L11.7099 15.6681C11.9831 15.6681 12.1197 15.4633 12.1197 15.1903L11.8465 10.5493C11.8465 10.2081 12.188 10.0033 12.4612 10.0716L16.5593 11.7778C16.7642 11.8461 16.9691 11.7778 17.1057 11.6413L19.9743 8.50184C20.1792 8.22884 20.589 8.29709 20.7256 8.63834L22.4332 13.0063C22.6381 13.5523 23.3211 13.7571 23.7992 13.4158L30.4927 8.43359C31.244 7.88759 30.7659 6.65909 29.8097 6.79559L25.5067 7.34159C25.3018 7.34159 25.0969 7.27334 25.0286 7.06859L22.7064 1.13084C22.4332 0.516593 21.6818 0.380093 21.2037 0.857843L16.1494 6.31784C16.0128 6.45434 15.8079 6.52259 15.603 6.45434L8.97782 3.65609C8.36311 3.38309 7.7484 3.79259 7.68009 4.47509L7.40689 11.3001C7.40689 11.5731 7.20199 11.7096 6.99708 11.7096L0.918272 12.1191C0.23526 12.1873 -0.174548 12.9381 0.23526 13.5523L4.26503 19.4901C4.40164 19.6266 4.40164 19.8996 4.26503 20.0361L0.166959 24.7453C-0.174548 25.0866 0.0303561 25.8373 0.576766 26.0421L5.28955 28.0896C5.49445 28.1578 5.63106 28.4308 5.56276 28.6356L2.5575 40.3063C2.3526 41.1253 3.30882 41.7396 3.99183 41.2618L15.2615 33.2083C15.3981 33.0718 15.603 33.0718 15.8079 33.2083L20.9305 36.8256C21.3403 37.0986 21.9551 37.0303 22.2283 36.5526L25.4384 31.6386C25.5067 31.5021 25.7116 31.4338 25.8482 31.4338L33.498 32.3893C34.1127 32.4576 34.7274 31.9798 34.5225 31.3656L31.3123 23.1073C31.244 22.9026 31.3123 22.6296 31.5855 22.4931L37.3911 19.7631C38.2107 19.3536 37.9375 18.0568 36.9813 18.0568Z"
          fill="#7121DB"
        />
      </svg>
    ),
  },
  {
    id: "pylon",
    name: "Pylon",
    description: "Support issues & account data",
    keyPlaceholder: "Pylon API token...",
    helpUrl: "https://docs.usepylon.com/pylon-docs/developer/api",
    helpSteps: [
      "Go to Pylon > Settings > API",
      "Create an API token (requires Admin)",
      "Copy the bearer token",
    ],
    logo: (
      <svg
        viewBox="0 0 25 26"
        className="h-full w-full"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M21.3437 4.1562C18.9827 1.79763 15.8424 0.5 12.5015 0.5C9.16056 0.5 6.02027 1.79763 3.66091 4.15455C1.29989 6.51147 0 9.64465 0 12.9798C0 16.3149 1.29989 19.448 3.66091 21.805C6.02193 24.1619 9.16222 25.4612 12.5031 25.4612C15.844 25.4612 18.9843 24.1635 21.3454 21.8066C23.7064 19.4497 25.0063 16.3165 25.0063 12.9814C25.0063 9.6463 23.7064 6.51312 21.3454 4.1562H21.3437ZM22.3949 12.9814C22.3949 17.927 18.7074 22.1227 13.8063 22.7699V3.1896C18.7074 3.83676 22.3949 8.0342 22.3949 12.9798V12.9814ZM4.8265 6.75643C6.43312 4.7835 8.68803 3.52063 11.1983 3.1896V6.75643H4.8265ZM11.1983 9.36162V11.6904H2.69428C2.79874 10.8926 3.00267 10.1097 3.2978 9.36162H11.1983ZM11.1983 14.2939V16.6227H3.30775C3.00931 15.8746 2.80371 15.0917 2.6976 14.2939H11.1983ZM11.1983 19.2279V22.7699C8.70129 22.4405 6.45302 21.1859 4.84805 19.2279H11.1983Z"
          fill="#5B0EFF"
        />
      </svg>
    ),
  },
];

// ─── Main Sidebar Component ─────────────────────────────────────────────────

export function IntegrationsSidebar({
  email,
  displayName,
  recentEmails,
}: {
  email: string;
  displayName: string;
  recentEmails: { id: string; subject: string }[];
}) {
  const statuses = useAllIntegrations();
  const anyConnected =
    statuses.apollo || statuses.hubspot || statuses.gong || statuses.pylon;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Integration data sections */}
      {statuses.apollo && <ApolloSection email={email} />}
      {statuses.hubspot && <HubSpotSection email={email} />}
      {statuses.gong && <GongSection email={email} />}
      {statuses.pylon && <PylonSection email={email} />}

      {/* Generic profile if nothing connected */}
      {!anyConnected && (
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-[14px] font-semibold text-foreground mb-1 truncate">
            {displayName}
          </h3>
          {displayName !== email && (
            <p className="text-[12px] text-muted-foreground truncate">
              {email}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/50">
            {email.split("@")[1]}
          </p>
        </div>
      )}

      {/* Recent emails */}
      {recentEmails.length > 0 && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3">
            <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Recent
            </h4>
            {recentEmails.map((e) => (
              <p
                key={e.id}
                className="text-[12px] text-muted-foreground/70 truncate mb-0.5"
              >
                {e.subject.length > 40
                  ? e.subject.slice(0, 40) + "..."
                  : e.subject}
              </p>
            ))}
          </div>
        </>
      )}

      {/* Integration setup */}
      <div className="h-px bg-border/30 mx-4" />
      <IntegrationSetup />
    </div>
  );
}

// ─── Integration Setup ──────────────────────────────────────────────────────

function IntegrationSetup() {
  const [expanded, setExpanded] = useState(false);
  const [configuring, setConfiguring] = useState<ProviderId | null>(null);
  const statuses = useAllIntegrations();

  if (configuring) {
    const def = INTEGRATIONS.find((i) => i.id === configuring)!;
    return (
      <IntegrationKeyEntry def={def} onBack={() => setConfiguring(null)} />
    );
  }

  if (!expanded) {
    const connectedCount = [
      statuses.apollo,
      statuses.hubspot,
      statuses.gong,
      statuses.pylon,
    ].filter(Boolean).length;
    return (
      <div className="px-4 py-2">
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          {connectedCount > 0
            ? `Integrations (${connectedCount}/${INTEGRATIONS.length})`
            : "Add integrations"}
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
          Integrations
        </h4>
        <button
          onClick={() => setExpanded(false)}
          className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground transition-colors"
        >
          Collapse
        </button>
      </div>
      <div className="space-y-1.5">
        {INTEGRATIONS.map((def) => {
          const connected = statuses[def.id];
          return (
            <IntegrationRow
              key={def.id}
              def={def}
              connected={connected}
              onConfigure={() => setConfiguring(def.id)}
            />
          );
        })}
        <AddIntegrationButton />
      </div>
    </div>
  );
}

function AddIntegrationButton() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSubmit = () => {
    const name = value.trim();
    if (!name) return;
    sendToAgentChat({
      message: `Add a ${name} integration to the sidebar`,
      context: `The user wants to add a new integration for "${name}" to the contact sidebar. Look at the existing integrations in client/components/email/IntegrationsSidebar.tsx and the pattern in server/routes/ and client/hooks/use-integrations.ts. Add the new provider following the same pattern: server route, hook, sidebar section, and logo. Use the real brand logo SVG if possible.`,
      submit: true,
    });
    setValue("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full py-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      >
        <div className="h-7 w-7 rounded-md border border-dashed border-border/40 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
          </svg>
        </div>
        <span>Add integration</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-border/50 bg-card shadow-xl p-2.5">
          <p className="text-[11px] text-muted-foreground/60 mb-1.5">
            What do you want to integrate?
          </p>
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="e.g. Salesforce, Intercom..."
              className="flex-1 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
            />
            <button
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Go
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IntegrationRow({
  def,
  connected,
  onConfigure,
}: {
  def: IntegrationDef;
  connected: boolean;
  onConfigure: () => void;
}) {
  const { disconnect } = useIntegration(def.id);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDisconnect) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setShowDisconnect(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDisconnect]);

  return (
    <div ref={ref} className="flex items-center gap-2.5 py-1.5 group relative">
      <div className="h-7 w-7 rounded-md overflow-hidden shrink-0 bg-accent/30 p-0.5">
        {def.logo}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-foreground/80">{def.name}</p>
        <p className="text-[10px] text-muted-foreground/50 truncate">
          {def.description}
        </p>
      </div>
      {connected ? (
        <div className="flex items-center gap-1 shrink-0">
          <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3 w-3 text-emerald-400"
            >
              <path
                fillRule="evenodd"
                d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <button
            onClick={() => setShowDisconnect(!showDisconnect)}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/30 hover:text-muted-foreground transition-colors"
            title="Settings"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path
                fillRule="evenodd"
                d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          onClick={onConfigure}
          className="shrink-0 text-[11px] text-primary/70 hover:text-primary font-medium transition-colors"
        >
          Connect
        </button>
      )}

      {showDisconnect && (
        <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-lg border border-border/50 bg-card shadow-lg py-1">
          <button
            onClick={() => {
              setShowDisconnect(false);
              onConfigure();
            }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-accent/50"
          >
            Update key
          </button>
          <button
            onClick={() => {
              disconnect.mutate();
              setShowDisconnect(false);
            }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-red-400/80 hover:bg-accent/50"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function IntegrationKeyEntry({
  def,
  onBack,
}: {
  def: IntegrationDef;
  onBack: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const { connect } = useIntegration(def.id);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onBack}
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path
              fillRule="evenodd"
              d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div className="h-6 w-6 rounded-md overflow-hidden shrink-0 bg-accent/30 p-0.5">
          {def.logo}
        </div>
        <span className="text-[13px] font-medium text-foreground">
          {def.name}
        </span>
      </div>

      <div className="flex gap-1.5 mb-3">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={def.keyPlaceholder}
          autoFocus
          className="flex-1 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
        />
        <button
          onClick={() => {
            if (apiKey.trim()) {
              connect.mutate(apiKey.trim(), { onSuccess: onBack });
            }
          }}
          disabled={!apiKey.trim() || connect.isPending}
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {connect.isPending ? "..." : "Save"}
        </button>
      </div>

      {/* Instructions always visible */}
      <div className="rounded-md bg-accent/30 px-2.5 py-2">
        <p className="text-[11px] text-muted-foreground/70 mb-1.5">
          To get your API key:
        </p>
        <ol className="text-[11px] text-muted-foreground/50 space-y-0.5 list-decimal pl-3 mb-1.5">
          {def.helpSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <a
          href={def.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary/80 hover:text-primary hover:underline transition-colors"
        >
          Open {def.name} Settings &rarr;
        </a>
      </div>
    </div>
  );
}

// ─── Apollo Section ─────────────────────────────────────────────────────────

function ApolloSection({ email }: { email: string }) {
  const { data: person, isLoading } = useApolloPerson(email);

  if (isLoading) return <SectionLoading />;
  if (!person) return null;

  const name =
    person.first_name || person.last_name
      ? [person.first_name, person.last_name].filter(Boolean).join(" ")
      : email;
  const location = [person.city, person.state, person.country]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      {/* Name & title */}
      <div className="px-4 pt-4 pb-3 flex items-start gap-3">
        {person.photo_url && (
          <img
            src={person.photo_url}
            alt=""
            className="h-9 w-9 rounded-full object-cover shrink-0 mt-0.5"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground truncate">
            {name}
          </h3>
          <p className="text-[12px] text-muted-foreground truncate">{email}</p>
          {person.title && (
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              {person.title}
            </p>
          )}
          {person.headline && person.headline !== person.title && (
            <p className="text-[11px] text-muted-foreground/50 truncate">
              {person.headline}
            </p>
          )}
          {location && (
            <p className="text-[11px] text-muted-foreground/50">{location}</p>
          )}
        </div>
      </div>

      {/* Company */}
      {person.organization && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              {person.organization.logo_url ? (
                <img
                  src={person.organization.logo_url}
                  alt=""
                  className="h-4 w-4 rounded object-contain shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-4 w-4 rounded bg-accent flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
                  {person.organization.name?.[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[13px] font-medium text-foreground truncate">
                {person.organization.name}
              </span>
            </div>
            {person.organization.short_description && (
              <p className="text-[11px] text-muted-foreground/70 line-clamp-2 mb-1.5">
                {person.organization.short_description}
              </p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60">
              {person.organization.industry && (
                <span>{person.organization.industry}</span>
              )}
              {person.organization.estimated_num_employees && (
                <span>
                  {person.organization.estimated_num_employees.toLocaleString()}
                  + emp
                </span>
              )}
              {person.organization.founded_year && (
                <span>Est. {person.organization.founded_year}</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Links */}
      {(person.linkedin_url ||
        person.twitter_url ||
        person.github_url ||
        person.organization?.website_url) && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-2 flex flex-wrap gap-3">
            {person.linkedin_url && (
              <a
                href={person.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                LinkedIn
              </a>
            )}
            {person.twitter_url && (
              <a
                href={person.twitter_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                X
              </a>
            )}
            {person.github_url && (
              <a
                href={person.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                GitHub
              </a>
            )}
            {person.organization?.website_url && (
              <a
                href={person.organization.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                {person.organization.website_url
                  .replace(/^https?:\/\/(www\.)?/, "")
                  .replace(/\/$/, "")}
              </a>
            )}
          </div>
        </>
      )}

      {/* Phone numbers */}
      {person.phone_numbers && person.phone_numbers.length > 0 && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-2">
            {person.phone_numbers.map((p, i) => (
              <p key={i} className="text-[11px] text-muted-foreground/60">
                {p.raw_number}
                {p.type && (
                  <span className="text-muted-foreground/40 ml-1">
                    ({p.type})
                  </span>
                )}
              </p>
            ))}
          </div>
        </>
      )}

      {/* Employment history */}
      {person.employment_history && person.employment_history.length > 1 && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3">
            <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Experience
            </h4>
            <div className="space-y-2">
              {person.employment_history.slice(0, 4).map((job, i) => (
                <div key={i}>
                  <p className="text-[12px] text-foreground/80 truncate">
                    {job.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground/50 truncate">
                    {job.organization_name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── HubSpot Section ────────────────────────────────────────────────────────

function HubSpotSection({ email }: { email: string }) {
  const { data: contact, isLoading } = useHubSpotContact(email);

  if (isLoading) return <SectionLoading />;
  if (!contact) return null;

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

  return (
    <>
      <div className="h-px bg-border/30 mx-4" />
      <div className="px-4 py-3">
        <SectionHeader logo={INTEGRATIONS[1].logo} label="HubSpot" />

        {name && (
          <p className="text-[12px] text-foreground/80 font-medium">{name}</p>
        )}
        {contact.title && (
          <p className="text-[11px] text-muted-foreground/60">
            {contact.title}
          </p>
        )}
        {contact.company && (
          <p className="text-[11px] text-muted-foreground/60">
            {contact.company}
          </p>
        )}
        {contact.lifecycleStage && (
          <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400/80">
            {contact.lifecycleStage}
          </span>
        )}

        {/* Deals */}
        {contact.deals?.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">
              Deals
            </p>
            {contact.deals.map((deal: any) => (
              <div key={deal.id} className="mb-1.5">
                <p className="text-[12px] text-foreground/70 truncate">
                  {deal.name}
                </p>
                <div className="flex gap-2 text-[10px] text-muted-foreground/50">
                  {deal.amount && (
                    <span>${Number(deal.amount).toLocaleString()}</span>
                  )}
                  {deal.stage && <span>{deal.stage}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tickets */}
        {contact.tickets?.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">
              Tickets
            </p>
            {contact.tickets.map((ticket: any) => (
              <div key={ticket.id} className="mb-1.5">
                <p className="text-[12px] text-foreground/70 truncate">
                  {ticket.subject}
                </p>
                <div className="flex gap-2 text-[10px] text-muted-foreground/50">
                  {ticket.priority && <span>{ticket.priority}</span>}
                  {ticket.stage && <span>{ticket.stage}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Gong Section ───────────────────────────────────────────────────────────

function GongSection({ email }: { email: string }) {
  const { data: calls, isLoading } = useGongCalls(email);

  if (isLoading) return <SectionLoading />;
  if (!calls || calls.length === 0) return null;

  return (
    <>
      <div className="h-px bg-border/30 mx-4" />
      <div className="px-4 py-3">
        <SectionHeader logo={INTEGRATIONS[2].logo} label="Gong Calls" />

        <div className="space-y-2">
          {calls.map((call: any) => {
            const date = call.started
              ? new Date(call.started).toLocaleDateString()
              : "";
            const mins = call.duration ? Math.round(call.duration / 60) : null;
            return (
              <div key={call.id}>
                <p className="text-[12px] text-foreground/70 truncate">
                  {call.title || "Untitled call"}
                </p>
                <div className="flex gap-2 text-[10px] text-muted-foreground/50">
                  {date && <span>{date}</span>}
                  {mins && <span>{mins}m</span>}
                  {call.direction && <span>{call.direction}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Pylon Section ──────────────────────────────────────────────────────────

function PylonSection({ email }: { email: string }) {
  const { data, isLoading } = usePylonContact(email);

  if (isLoading) return <SectionLoading />;
  if (!data || (!data.account && data.issues?.length === 0)) return null;

  return (
    <>
      <div className="h-px bg-border/30 mx-4" />
      <div className="px-4 py-3">
        <SectionHeader logo={INTEGRATIONS[3].logo} label="Pylon" />

        {data.account && (
          <div className="mb-2">
            <p className="text-[12px] text-foreground/80 font-medium">
              {data.account.name}
            </p>
            {data.account.domain && (
              <p className="text-[11px] text-muted-foreground/60">
                {data.account.domain}
              </p>
            )}
            {data.account.type && (
              <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-400/80">
                {data.account.type}
              </span>
            )}
          </div>
        )}

        {data.issues?.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1">
              Issues
            </p>
            {data.issues.map((issue: any) => {
              const stateColor: Record<string, string> = {
                new: "text-blue-400",
                waiting_on_you: "text-yellow-400",
                waiting_on_customer: "text-muted-foreground/50",
                on_hold: "text-muted-foreground/40",
                closed: "text-emerald-400/60",
              };
              return (
                <div key={issue.id} className="mb-1.5">
                  <p className="text-[12px] text-foreground/70 truncate">
                    {issue.title}
                  </p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground/50">
                    {issue.state && (
                      <span
                        className={
                          stateColor[issue.state] || "text-muted-foreground/50"
                        }
                      >
                        {issue.state.replace(/_/g, " ")}
                      </span>
                    )}
                    {issue.assignee && <span>{issue.assignee}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function SectionHeader({
  logo,
  label,
}: {
  logo: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <div className="h-4 w-4 rounded overflow-hidden shrink-0">{logo}</div>
      <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="px-4 py-4 flex items-center justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}
