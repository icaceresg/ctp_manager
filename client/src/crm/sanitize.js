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

/** Vista previa aproximada del marco corporativo; el envío de prueba muestra el real. */
export function previewDocument({ subject, title, preheader, html, action, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#EBEBEB;font-family:Arial,Helvetica,sans-serif;color:#17191D}.shell{max-width:600px;margin:24px auto;background:#fff;border:1px solid #e3e3e3}.head{padding:22px 30px;border-top:4px solid #D4A030;display:flex;justify-content:space-between;align-items:center}.logo{font-weight:800;font-size:26px;letter-spacing:1px;color:#17191D}.logo b{color:#D4A030}.kicker{font-size:10px;color:#5b6068;letter-spacing:1px}.body{padding:30px 34px;font-size:16px;line-height:26px;word-wrap:break-word}.body img{max-width:100%;height:auto}h1.t{font-size:28px;line-height:35px;margin:0 0 20px}.cta{display:inline-block;background:#D4A030;color:#0E0F11;font-weight:bold;padding:0 26px;line-height:46px;text-decoration:none;margin-top:18px}.foot{padding:20px 34px;background:#fafafa;border-top:1px solid #EBEBEB;font-size:11px;color:#5b6068}.meta{max-width:600px;margin:12px auto 0;font-size:12px;color:#444}.meta strong{color:#111}</style></head><body><div class="meta"><strong>${escapeHtml(subject || '(sin asunto)')}</strong>${preheader ? ` · ${escapeHtml(preheader)}` : ''}</div><div class="shell"><div class="head"><span class="logo">C<b>T</b>P</span><span class="kicker">#PlayCTP</span></div><div class="body">${title ? `<h1 class="t">${escapeHtml(title)}</h1>` : ''}${sanitizeHtml(html)}${action ? `<p><span class="cta">${escapeHtml(action)} ↗</span></p>` : ''}</div><div class="foot">${escapeHtml(footer || '')}</div></div></body></html>`;
}
