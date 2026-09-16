import type {
  MarkedExtension as MarkedExtensionType,
  Tokens as TokenTypes,
} from "marked";
import { marked as MarkedNamespace } from "marked";

declare module "marked" {
  namespace marked {
    type MarkedExtension = MarkedExtensionType;

    namespace Tokens {
      type Generic = TokenTypes.Generic;
    }
  }
}

export type MarkedNamespaceCompatibility = [
  MarkedNamespace.MarkedExtension,
  MarkedNamespace.Tokens.Generic,
];
