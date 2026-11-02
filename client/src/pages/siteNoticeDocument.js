const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FRAME_STYLE = `*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;padding:8px 3px 20px;background:#151518;color:#e8e5de;font:16px/1.65 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}h2,h3{color:#fff;line-height:1.2;margin:0 0 16px}h2{font-size:28px}h3{font-size:22px}p,ul,ol,blockquote{margin:0 0 18px}a{color:#fed602;text-decoration:underline;text-underline-offset:3px}a:focus-visible{outline:2px solid #fed602;outline-offset:4px}img{display:block;max-width:100%;height:auto;border-radius:10px;margin:16px auto}blockquote{border-left:3px solid #fed602;padding:8px 16px;color:#c8c4bc}hr{border:0;border-top:1px solid #383735;margin:24px 0}ul,ol{padding-left:24px}small{font-size:13px;color:#b4afa5}@media(max-width:420px){body{font-size:15px}h2{font-size:24px}}`;

/** Same CTP content styling, with absolute URLs instead of a forbidden base tag. */
export function siteNoticeDocument(html, origin) {
  let base;
  try { base = new URL(origin); } catch { return ''; }
  const approved = base.origin === origin && (base.protocol === 'https:' && /^(pre\.)?playctp\.com$/.test(base.hostname)
    || base.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(base.hostname));
  if (!approved) return '';
  // The parent Manager CSP permits only its own base URI. Canonical attribute
  // values are already escaped; prepend only the separately validated origin.
  const content = html.replace(/\b(href|src)="(\/(?!\/)[^"]*)"/g, (_match, name, target) => `${name}="${escape(origin)}${target}"`);
  const policy = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${origin} https://playctp.com https://pre.playctp.com; base-uri 'none'; form-action 'none'; object-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><style>${FRAME_STYLE}</style></head><body>${content}</body></html>`;
}
export function noticePreviewOrigin(location) {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return location.origin;
  return location.hostname === 'pre.manager.playctp.com' ? 'https://pre.playctp.com' : 'https://playctp.com';
}
