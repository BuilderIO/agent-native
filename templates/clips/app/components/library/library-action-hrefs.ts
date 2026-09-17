export interface LibraryActionScope {
  folderId?: string | null;
  spaceId?: string | null;
}

function scopedPath(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildLibraryActionHrefs({
  folderId,
  spaceId,
}: LibraryActionScope) {
  const scope = new URLSearchParams();
  if (spaceId) scope.set("spaceId", spaceId);
  if (folderId) scope.set("folderId", folderId);

  const uploadParams = new URLSearchParams(scope);
  uploadParams.set("autoUpload", "1");

  return {
    recordHref: scopedPath("/record", scope),
    uploadHref: scopedPath("/record", uploadParams),
    importLoomHref: scopedPath("/import", scope),
  };
}
