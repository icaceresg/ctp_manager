// Shared validation only. Manager never fetches these URLs or handles Google credentials.
export const MAX_DRIVE_URL_LENGTH = 2048;
const ID = '[A-Za-z0-9_-]{1,200}';
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,200}$/;

export function parseDriveLink(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const input = value.trim();
  if (!input || input.length > MAX_DRIVE_URL_LENGTH || /[\s\u0000-\u001f\u007f]/u.test(input)) return null;
  if (!/^https:\/\/(?:drive|docs)\.google\.com(?:\/|$|\?)/i.test(input)) return null;
  let parsed;
  try { parsed = new URL(input); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (!['drive.google.com', 'docs.google.com'].includes(parsed.hostname)) return null;
  // Discard navigation/tracking parameters, but never accept credential-bearing URLs.
  if ([...parsed.searchParams.keys()].some(key => /^(?:access_token|refresh_token|id_token|code|token|client_secret)$/i.test(key))) return null;
  const keys = parsed.searchParams.getAll('resourcekey');
  if (keys.length > 1 || (keys.length && !RESOURCE_KEY.test(keys[0]))) return null;
  if (parsed.searchParams.getAll('id').length > 1) return null;
  const resourceKey = keys[0];
  let match, id, kind, canonical;
  if (parsed.hostname === 'drive.google.com') {
    match = parsed.pathname.match(new RegExp(`^/file/d/(${ID})(?:/(?:view|edit|preview))?/?$`));
    if (match) { id = match[1]; kind = 'file'; canonical = `https://drive.google.com/file/d/${id}/view`; }
    else if (['/open', '/uc'].includes(parsed.pathname)) {
      const ids = parsed.searchParams.getAll('id');
      if (ids.length !== 1 || !new RegExp(`^${ID}$`).test(ids[0])) return null;
      id = ids[0]; kind = 'file'; canonical = `https://drive.google.com/file/d/${id}/view`;
    } else {
      match = parsed.pathname.match(new RegExp(`^/drive/(?:u/[0-9]+/)?folders/(${ID})/?$`));
      if (!match) return null;
      id = match[1]; kind = 'folder'; canonical = `https://drive.google.com/drive/folders/${id}`;
    }
  } else {
    match = parsed.pathname.match(new RegExp(`^/(document|spreadsheets|presentation)/d/(${ID})(?:/(?:edit|view|preview))?/?$`));
    if (!match) return null;
    kind = { document: 'document', spreadsheets: 'spreadsheet', presentation: 'presentation' }[match[1]];
    id = match[2]; canonical = `https://docs.google.com/${match[1]}/d/${id}/edit`;
  }
  const url = new URL(canonical);
  if (resourceKey) url.searchParams.set('resourcekey', resourceKey);
  let downloadUrl = null;
  if (kind === 'file') {
    // Browser-only Drive download attempt: Google controls access/confirmation.
    const download = new URL('https://drive.google.com/uc');
    download.searchParams.set('export', 'download');
    download.searchParams.set('id', id);
    if (resourceKey) download.searchParams.set('resourcekey', resourceKey);
    downloadUrl = download.href;
  }
  return { url: url.href, kind, downloadUrl };
}
