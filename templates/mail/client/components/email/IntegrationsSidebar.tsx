import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  useIntegration,
  useAllIntegrations,
  useHubSpotContact,
  useGongCalls,
} from "@/hooks/use-integrations";
import { useApolloPerson } from "@/hooks/use-apollo";
import type { ApolloPersonResult } from "@shared/types";

// ─── Integration definitions ────────────────────────────────────────────────

type ProviderId = "apollo" | "hubspot" | "gong";

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
      <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
        <rect width="24" height="24" rx="6" fill="#6B4FBB" />
        <path
          d="M12 5L7 18h2.5l1-2.8h5l1 2.8H19L14 5h-2zm0 3.6L14.4 14h-4.8L12 8.6z"
          fill="white"
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
      <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
        <rect width="24" height="24" rx="6" fill="#FF7A59" />
        <path
          d="M15.5 8.5V7a1.5 1.5 0 10-3 0v1.5a3.5 3.5 0 00-2 2.27l-1.3-.76a1.25 1.25 0 10-.7 1.22l1.28.74a3.5 3.5 0 002.72 3.5V17a1.5 1.5 0 103 0v-1.53a3.5 3.5 0 00-.5-6.97zm-.5 5.5a2 2 0 110-4 2 2 0 010 4z"
          fill="white"
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
      <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
        <rect width="24" height="24" rx="6" fill="#7B5CFF" />
        <circle cx="12" cy="10" r="4" fill="white" fillOpacity="0.9" />
        <path
          d="M12 14.5c-3 0-5.5 1.5-5.5 3.5h11c0-2-2.5-3.5-5.5-3.5z"
          fill="white"
          fillOpacity="0.7"
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
  const anyConnected = statuses.apollo || statuses.hubspot || statuses.gong;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Integration data sections */}
      {statuses.apollo && <ApolloSection email={email} />}
      {statuses.hubspot && <HubSpotSection email={email} />}
      {statuses.gong && <GongSection email={email} />}

      {/* Generic profile if nothing connected */}
      {!anyConnected && (
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-[14px] font-semibold text-foreground mb-1">
            {displayName}
          </h3>
          {displayName !== email && (
            <p className="text-[12px] text-muted-foreground">{email}</p>
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
    ].filter(Boolean).length;
    return (
      <div className="px-4 py-2">
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          {connectedCount > 0
            ? `Integrations (${connectedCount}/3)`
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
      </div>
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
      <div className="h-7 w-7 rounded-md overflow-hidden shrink-0">
        {def.logo}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-foreground/80">{def.name}</p>
        <p className="text-[10px] text-muted-foreground/50 truncate">
          {def.description}
        </p>
      </div>
      {connected ? (
        <button
          onClick={() => setShowDisconnect(!showDisconnect)}
          className="shrink-0 h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center"
          title="Connected"
        >
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
        </button>
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
  const [showHelp, setShowHelp] = useState(false);
  const { connect } = useIntegration(def.id);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHelp) return;
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node))
        setShowHelp(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHelp]);

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
              d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div className="h-6 w-6 rounded-md overflow-hidden shrink-0">
          {def.logo}
        </div>
        <span className="text-[13px] font-medium text-foreground">
          {def.name}
        </span>
        <div className="flex-1" />
        <div className="relative" ref={helpRef}>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-muted-foreground/40 hover:text-muted-foreground border border-border/40 hover:border-border transition-colors"
          >
            ?
          </button>
          {showHelp && (
            <div className="absolute right-0 top-6 z-50 w-52 rounded-lg border border-border bg-popover p-3 shadow-lg">
              <p className="text-[11px] text-muted-foreground mb-2">
                To get your API key:
              </p>
              <ol className="text-[11px] text-muted-foreground/70 space-y-1 list-decimal pl-3 mb-2">
                {def.helpSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <a
                href={def.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline"
              >
                Open {def.name} Settings
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1.5">
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
          <h3 className="text-[14px] font-semibold text-foreground">{name}</h3>
          <p className="text-[12px] text-muted-foreground">{email}</p>
          {person.title && (
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              {person.title}
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
            </div>
          </div>
        </>
      )}

      {/* Links */}
      {(person.linkedin_url || person.twitter_url || person.github_url) && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-2 flex gap-3">
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
        <div className="flex items-center gap-1.5 mb-2">
          <div className="h-4 w-4 rounded overflow-hidden shrink-0">
            <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
              <rect width="24" height="24" rx="4" fill="#FF7A59" />
              <path d="M12 8a2 2 0 100-4 2 2 0 000 4z" fill="white" />
            </svg>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            HubSpot
          </span>
        </div>

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
        <div className="flex items-center gap-1.5 mb-2">
          <div className="h-4 w-4 rounded overflow-hidden shrink-0">
            <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
              <rect width="24" height="24" rx="4" fill="#7B5CFF" />
              <circle cx="12" cy="10" r="3" fill="white" fillOpacity="0.9" />
            </svg>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            Gong Calls
          </span>
        </div>

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

// ─── Shared ─────────────────────────────────────────────────────────────────

function SectionLoading() {
  return (
    <div className="px-4 py-4 flex items-center justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}
