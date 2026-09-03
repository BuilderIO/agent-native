// Final marketing art per app, keyed by catalog slug, shared by the homepage
// carousel and the /apps grid so the two cannot drift. The carousel lists a
// subset of these slugs; the extra entries only surface on /apps.
export interface AppArt {
  // Both variants or neither: a dark screenshot shown in light mode reads
  // worse than no screenshot at all, so a card without both falls back.
  imageDark: string;
  imageLight: string;
}

// A slug absent from this map has no final art yet, which the cards render
// differently from having art — no placeholder URL stands in for "missing".
export const APP_ART: Record<string, AppArt> = {
  analytics: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fba632b39758d448594f7e5d2403e5d0f",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F976ea93771b64b9e8c1b3eb12e606e07",
  },
  assets: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fde445dd867744e9bac5d3e5d04c903b2",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fac5701f0871f4edbb06fa9cdb12b166e",
  },
  calendar: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F91d4c18d256b49e6bca24c23ce90a4f2",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F8d9d48bb2f1d498f9601ac28c64edd4c",
  },
  chat: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9cbe28ba94b54634b30805fef86ba373",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc27e6df53d694b95978f23266263c78d",
  },
  clips: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4dc9c87b9a224132855e1cb68cd89f9e",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F462fdb643d5d403a8c54540c5c3292f6",
  },
  content: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa9f30380b03b4fd1a7d2ab371ddfd798",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F979f792c79834470a513a9d9b733dd84",
  },
  design: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F072f66a3e360464fb48617670ceee46f",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc9f693f170294bde8ebc733cff368af9",
  },
  dispatch: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1e0b53e7a9ed425d9454c766ff367e9a",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb213b1b827c3406db2c9cc061e0c2069",
  },
  forms: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1c0413f72cd54819b4530fbb8089b503",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F17dbe9fb1c2b449ba21dc7f8bafac404",
  },
  mail: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F216aaef9859144ffa3eb9498fa1132da",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F064aee3ec5cd44879b9c186f63a6d6f4",
  },
  plan: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe89439e917044fc9ac9663737e35bf1f",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F98427229c8c84c30afee56172503c294",
  },
  slides: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F710f5b7586cc41deaa0e6f8de658a499",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6223a64717a04931a6f509696019f48b",
  },
};
