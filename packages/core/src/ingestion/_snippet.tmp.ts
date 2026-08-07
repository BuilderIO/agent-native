/** Resolves a slide master's color-alias mapping plus its title/body default text-color fills (from p:txStyles), so placeholder text without its own explicit color can inherit the right one. */
async function parseMasterColorInfo(args: {
  zip: ZipArchive;
  target: string;
  parseXml: (xml: string) => unknown;
}): Promise<{
  clrMap: Record<string, string>;
  titleFill: Record<string, unknown> | null;
  bodyFill: Record<string, unknown> | null;
}> {
  const empty = { clrMap: {}, titleFill: null, bodyFill: null };
  const path = args.target.startsWith("/")
    ? args.target.slice(1)
    : "ppt/" + args.target.replace(/^\.\.\//, "");
  const xml = await args.zip.file(path)?.async("string");
  if (!xml) return empty;
  const root = record(record(args.parseXml(xml))?.["p:sldMaster"]);
  if (!root) return empty;
  const clrMap = parseClrMapNode(record(root["p:clrMap"]));
  const txStyles = record(root["p:txStyles"]);
  const titleDefRPr = record(
    record(record(txStyles?.["p:titleStyle"])?.["a:lvl1pPr"])?.["a:defRPr"],
  );
  const bodyDefRPr = record(
    record(record(txStyles?.["p:bodyStyle"])?.["a:lvl1pPr"])?.["a:defRPr"],
  );
  return {
    clrMap,
    titleFill: record(titleDefRPr?.["a:solidFill"]),
    bodyFill: record(bodyDefRPr?.["a:solidFill"]),
  };
}
