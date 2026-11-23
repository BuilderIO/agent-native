import { useMemo, type Ref } from "react";

const syntax =
  /(?<comment>#[^\n]*)|(?<string>(?:[fFrRbBuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*(?:"|(?=\n)|$)|'(?:\\.|[^'\\\n])*(?:'|(?=\n)|$)))|(?<keyword>\b(?:False|None|True|and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b)|(?<number>\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)[jJ]?\b)|(?<builtin>\b(?:abs|all|any|dict|enumerate|float|int|len|list|max|min|print|range|set|sorted|str|sum|tuple|type|zip)\b)/g;

export function PythonSourceHighlight({
  source,
  paintRef,
}: {
  source: string;
  paintRef?: Ref<HTMLPreElement>;
}) {
  const tokens = useMemo(() => {
    let offset = 0;
    const result = [];
    for (const match of source.matchAll(syntax)) {
      result.push(source.slice(offset, match.index));
      const kind = Object.keys(match.groups ?? {}).find(
        (key) => match.groups?.[key] !== undefined,
      );
      result.push(
        <span key={match.index} data-python-token={kind}>
          {match[0]}
        </span>,
      );
      offset = match.index + match[0].length;
    }
    result.push(source.slice(offset));
    return result;
  }, [source]);

  return (
    <pre
      ref={paintRef}
      aria-hidden={paintRef ? true : undefined}
      className={
        paintRef
          ? "nb-cell-source nb-python-paint"
          : "nb-cell-source is-readonly"
      }
    >
      {tokens}
    </pre>
  );
}
