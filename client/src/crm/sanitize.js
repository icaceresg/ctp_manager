// Saneado en el navegador antes de insertar HTML en el editor o en la vista
// previa. DOMParser no ejecuta scripts ni manejadores del documento analizado.
// CTP vuelve a sanear en el envío: esta copia protege a quien edita.
const ALLOWED = new Set(['p','br','strong','b','em','i','u','s','a','img','h1','h2','h3','h4','ul','ol','li','blockquote','hr','span','div','table','thead','tbody','tr','td','th','center','small','sup','sub']);
const DROP = new Set(['script','style','iframe','object','embed','svg','math','template','noscript','title','head','form','textarea','select','button','input','video','audio','canvas','frameset','frame','applet','link','meta','base']);
const ATTRS = { '*':['style','align','dir','title'], a:['href','target'], img:['src','alt','width','height'], td:['colspan','rowspan','width','valign','bgcolor'], th:['colspan','rowspan','width','valign','bgcolor'], table:['width','cellpadding','cellspacing','border','bgcolor','role'] };

export function safeUrl(value, { link = false } = {}) {
  const raw = String(value || '').replace(/[\x00-\x20\x7f]+/g, '');
  if (link && /^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(raw)) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) { child.remove(); continue; }
    clean(child);
    if (!ALLOWED.has(tag)) { child.replaceWith(...child.childNodes); continue; }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (!(ATTRS['*'].includes(name) || ATTRS[tag]?.includes(name))) { child.removeAttribute(attr.name); continue; }
      if (name === 'href' || name === 'src') { const url = safeUrl(attr.value, { link: name === 'href' }); if (url) child.setAttribute(name, url); else child.removeAttribute(attr.name); }
      if (name === 'style' && /url\s*\(|expression|javascript:|@import|behavior/i.test(attr.value)) child.removeAttribute(attr.name);
    }
    if (tag === 'img' && !child.getAttribute('src')) child.remove();
  }
}
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${String(html || '')}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
/** Texto plano por defecto → párrafos HTML editables. */
export function textToHtml(text) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n\n+/).filter(part => part.trim()).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('');
}
export function htmlIsEmpty(html) { return !String(html || '').replace(/<(?!img)[^>]*>/gi, '').replace(/&nbsp;/g, ' ').trim() && !/<img/i.test(html || ''); }

// Mismo marco oscuro que renderCorporateEmail en CTP (services/notification-worker/email.mjs).
const PREVIEW_STYLE = 'body{margin:0;padding:24px 14px 34px;background:#090B0F;font-family:Arial,Helvetica,sans-serif;color:#CBD0D8}'
  + '.meta{max-width:600px;margin:0 auto 12px;font-size:12px;color:#959BA6}.meta strong{color:#F5F5F6}'
  + '.shell{max-width:600px;margin:0 auto;background:#13161C;border:1px solid #2A2E35}.bar{height:5px;background:#FED602}'
  + '.head{padding:39px 44px 29px;text-align:center}.head img{display:inline-block;width:184px;max-width:100%;height:auto}'
  + '.body{padding:24px 52px 44px;text-align:center;font-size:16px;line-height:26px;word-wrap:break-word}.body img{max-width:100%;height:auto}'
  + '.body a{color:#FED602}.body h1,.body h2,.body h3,.body h4,.body strong,.body b{color:#fff}.body ul,.body ol{display:table;margin:0 auto 16px;padding-left:22px;text-align:left}'
  + '.kicker{margin:0 0 16px;color:#FED602;font-size:12px;font-weight:bold;letter-spacing:3px;line-height:18px;text-transform:uppercase}'
  + 'h1.t{margin:0 0 22px;color:#fff;font-size:42px;line-height:49px;font-weight:800;letter-spacing:-1px}'
  + '.cta{display:inline-block;margin-top:16px;background:#FED602;color:#101114;font-size:14px;line-height:20px;letter-spacing:1px;font-weight:800;text-transform:uppercase;padding:17px 30px;border-radius:6px}'
  + '.sign{margin-top:37px;padding-top:27px;border-top:1px solid #30343C}.tag{margin:0 0 9px;color:#FED602;font-size:13px;line-height:19px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase}'
  + '.motto{margin:0;color:#D4D7DD;font-size:15px;line-height:25px}.hash{margin:19px 0 0;color:#fff;font-size:16px;line-height:24px;font-weight:bold}'
  + '.foot{padding:28px 38px;background:#0D1015;border-top:1px solid #292D35;text-align:center;font-size:11px;line-height:18px;color:#959BA6}.foot p{margin:0 0 9px}.foot p:last-child{margin:0}'
  + '.foot .help{font-size:13px;line-height:20px;color:#C4C8D0}.foot .mail{margin-bottom:17px;font-size:13px;line-height:20px;color:#FED602;text-decoration:underline}.foot u{color:#959BA6}'
  + '@media(max-width:620px){body{padding:16px 8px}.head{padding:30px 24px 24px}.body{padding:34px 24px}.foot{padding:25px 20px}h1.t{font-size:33px;line-height:39px}}';

/** Vista previa aproximada del marco corporativo (textos en español); el envío de prueba muestra el real. */
export function previewDocument({ subject, title, preheader, html, action, footer, unsubscribe = false }) {
  const logo = typeof document === 'undefined' ? '/brand/logo-ctp.svg' : new URL('/brand/logo-ctp.svg', document.baseURI).href;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${PREVIEW_STYLE}</style></head><body>`
    + `<div class="meta"><strong>${escapeHtml(subject || '(sin asunto)')}</strong>${preheader ? ` · ${escapeHtml(preheader)}` : ''}</div>`
    + `<div class="shell"><div class="bar"></div><div class="head"><img src="${escapeHtml(logo)}" alt="PlayCTP"></div>`
    + `<div class="body">${title ? `<p class="kicker">Cuenta · Competición · Comunidad</p><h1 class="t">${escapeHtml(title)}</h1>` : ''}${sanitizeHtml(html)}${action ? `<span class="cta">${escapeHtml(action)} →</span>` : ''}`
    + '<div class="sign"><p class="tag">Tu próximo reto empieza aquí</p><p class="motto">Compite. Supérate. Haz que cada partida cuente.</p><p class="hash">#PlayCTP 💛</p></div></div>'
    + `<div class="foot"><p class="help">¿Necesitas ayuda?</p><p class="mail">contact@playctp.com</p><p>${escapeHtml(footer || '')}</p>`
    + `<p><u>Visitar CTP</u> &nbsp;·&nbsp; <u>Privacidad</u>${unsubscribe ? ' &nbsp;·&nbsp; <u>Dar de baja comunicaciones comerciales</u>' : ''}</p><p>© PlayCTP. Todos los derechos reservados.</p></div></div></body></html>`;
}
