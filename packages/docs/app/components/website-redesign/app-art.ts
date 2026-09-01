// Final marketing art per app, keyed by catalog slug, shared by the homepage
// carousel and the /apps grid so the two cannot drift.
export interface AppArt {
  // Both variants or neither: a dark screenshot shown in light mode reads
  // worse than no screenshot at all, so a card without both falls back.
  imageDark: string;
  imageLight: string;
}

// A slug absent from this map has no final art yet, which the cards render
// differently from having art — no placeholder URL stands in for "missing".
export const APP_ART: Record<string, AppArt> = {
  clips: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F469bb8923c3a4fe8aeeb76524757ebc0",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb06a2d6d71404a42874e09b4c2493f2f",
  },
  design: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdb2aa3507abd455781fd9a918b49556d",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdcc7ffad1b2143d8ad848d897d48090a",
  },
  slides: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F68cfef4529c5464196005a9f40c92d5c",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc10fec20f1244fee95ced166261e9fec",
  },
  analytics: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd8f72ede40714d5f80adcc885b71afb6",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd7e394cf1fd54a078881358a944c8280",
  },
  calendar: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F18c4d2061c584743aa4915169de8f6b2",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3351715f7c6a402f9f006d83d333dc58",
  },
  mail: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1dab5941bced4ea88b6c29ca9c8842f5",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F5b10f254a3f8464b8b03a4786ec85761",
  },
  assets: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F505903e15f1445e589d76da4702953c0",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fcb8bc4b883e649a7ba64b3a500b1f555",
  },
  content: {
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F54069e80e822449b935ae764a1982a96",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdd23954911e94101a7a0f0393a195dad",
  },
};
