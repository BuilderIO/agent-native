import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class AgentNativeSlidesApi {
  name = "agentNativeSlidesApi";

  displayName = "Agent-Native Slides API";

  documentationUrl = "agentNativeSlides";

  properties: INodeProperties[] = [
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://slides.agent-native.com",
      required: true,
    },
    {
      displayName: "API Token",
      name: "apiToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
  ];

  authenticate = {
    type: "generic" as const,
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiToken}}",
      },
    },
  };

  test = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/_agent-native/actions/list-decks?light=true",
      method: "GET" as const,
    },
  };
}

const credentialTypeCheck: ICredentialType = new AgentNativeSlidesApi();
void credentialTypeCheck;
