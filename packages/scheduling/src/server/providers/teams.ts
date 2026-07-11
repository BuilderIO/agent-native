/**
 * Microsoft Teams provider — delegated Microsoft OAuth with Graph-backed
 * standalone online meetings.
 */
import type { VideoProvider } from "./types.js";

export interface TeamsProviderConfig {
  clientId: string;
  clientSecret: string;
  /** Microsoft tenant id/domain; defaults to work-or-school accounts. */
  tenant?: string;
  getAccessToken: (credentialId: string) => Promise<string>;
  updateTokens?: (
    credentialId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
      rawResponse?: Record<string, unknown>;
    },
  ) => Promise<void>;
  /** Called when Graph returns 401/403; mark the credential invalid in UI. */
  markInvalid?: (credentialId: string) => Promise<void>;
}

const SCOPES = ["offline_access", "OnlineMeetings.ReadWrite", "User.Read"];
const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export function createTeamsProvider(
  config: TeamsProviderConfig,
): VideoProvider {
  const tenant = config.tenant ?? "organizations";
  const oauthBaseUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

  async function graphRequest(
    credentialId: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await config.getAccessToken(credentialId);
    const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    if (response.status === 401 || response.status === 403) {
      await config.markInvalid?.(credentialId);
    }
    return response;
  }

  return {
    kind: "teams_video",
    label: "Microsoft Teams",

    async startOAuth({ redirectUri, state }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: SCOPES.join(" "),
        prompt: "consent",
        state,
      });
      return { authUrl: `${oauthBaseUrl}/authorize?${params}` };
    },

    async completeOAuth({ code, redirectUri, credentialId, userEmail }) {
      const requestBody = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: SCOPES.join(" "),
      });
      const tokenResponse = await fetch(`${oauthBaseUrl}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: requestBody,
      });
      if (!tokenResponse.ok) {
        throw new Error(
          `Microsoft Teams token exchange failed (${tokenResponse.status})`,
        );
      }
      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        [key: string]: unknown;
      };
      if (!tokens.access_token) {
        throw new Error(
          "Microsoft Teams token exchange returned no access token",
        );
      }

      await config.updateTokens?.(credentialId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
        rawResponse: tokens,
      });

      // Use the token from this exchange directly. The consumer's token store
      // may not be observable through getAccessToken until after this callback.
      const identityResponse = await fetch(
        `${GRAPH_BASE_URL}/me?$select=id,mail,userPrincipalName,displayName`,
        { headers: { authorization: `Bearer ${tokens.access_token}` } },
      );
      if (!identityResponse.ok) {
        throw new Error(
          `Microsoft Teams identity lookup failed (${identityResponse.status})`,
        );
      }
      const identity = (await identityResponse.json()) as {
        id?: string;
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      };
      if (!identity.id) {
        throw new Error(
          "Microsoft Teams identity lookup returned no account id",
        );
      }
      return {
        externalAccountId: identity.id,
        externalEmail: identity.mail ?? identity.userPrincipalName ?? userEmail,
        displayName: identity.displayName,
      };
    },

    async createMeeting({ credentialId, booking }) {
      if (!credentialId) {
        throw new Error("Microsoft Teams requires credentialId");
      }
      const response = await graphRequest(credentialId, "/me/onlineMeetings", {
        method: "POST",
        body: JSON.stringify({
          subject: booking.title,
          startDateTime: booking.startTime,
          endDateTime: booking.endTime,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Microsoft Teams meeting creation failed (${response.status})`,
        );
      }
      const meeting = (await response.json()) as {
        id?: string;
        joinWebUrl?: string;
      };
      if (!meeting.id || !meeting.joinWebUrl) {
        throw new Error(
          "Microsoft Teams meeting response is missing id or joinWebUrl",
        );
      }
      return { meetingId: meeting.id, meetingUrl: meeting.joinWebUrl };
    },

    async deleteMeeting({ credentialId, meetingId }) {
      if (!credentialId) return;
      const response = await graphRequest(
        credentialId,
        `/me/onlineMeetings/${encodeURIComponent(meetingId)}`,
        { method: "DELETE" },
      );
      if (response.status === 204 || response.status === 404) return;
      if (!response.ok) {
        throw new Error(
          `Microsoft Teams meeting deletion failed (${response.status})`,
        );
      }
    },
  };
}
