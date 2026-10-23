import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import '@fontsource/saira-condensed/800.css';
import './ruleta.css';
import { AudioEngine } from './audio.js';
import { CAPTCHA_MESSAGES, captchaCanSubmit, mountLoginCaptcha } from '../auth-captcha.js';
import '../auth-captcha.css';

const app = document.getElementById('app');
const canvas = document.getElementById('stage');
const audio = new AudioEngine();
let stage = null;
let me = null;
let participants = [];
let roster = null; // { source, warning, truncated, total, refreshed_at }
let provider = 'local';
let excluded = new Set(loadExcluded());
let drawing = false;
let loginCaptcha = null;

// ---------- utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel) => app.querySelector(sel);

// Distintivo de quien tiene acceso a Manager, según su función de staff.
const STAFF_LABELS = { operations: 'coordinación', referee: 'árbitro', production: 'producción', caster: 'caster', communications: 'comunicación', clubs: 'clubes', executive: 'dirección' };
const roleLabel = (p) => (p.role === 'admin' ? 'admin' : STAFF_LABELS[p.staff_kind] || (p.role === 'referee' ? 'árbitro' : 'staff'));

async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Error de conexión.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function loadExcluded() {
  try {
    return JSON.parse(localStorage.getItem('ruleta.excluded.v2') || '[]');
  } catch {
    return [];
  }
}
function saveExcluded() {
  try {
    localStorage.setItem('ruleta.excluded.v2', JSON.stringify([...excluded]));
  } catch {
    /* sin almacenamiento: la selección dura hasta recargar */
  }
}

const icon = {
  users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// ---------- pantallas ----------

function renderLogin(error = '') {
  loginCaptcha?.destroy();
  loginCaptcha = null;
  app.innerHTML = `
    <div class="gate">
      <form class="gate-card" id="login">
        <div class="partners"><img src="/brand/logo-ctp.svg" alt="PlayCTP" class="gate-logo" /><span class="partners-x">×</span><img src="/ruleta-media/miami-heretics.webp" alt="Miami Heretics" class="partner-logo" /></div>
        <h1>La caja del destino</h1>
        <p class="muted">Solo staff de PlayCTP: entra con la misma cuenta que usas en <strong>manager.playctp.com</strong>.</p>
        ${provider === 'ctp'
          ? '<label>Correo de tu cuenta CTP<input name="username" type="email" autocomplete="email" required autofocus /></label>'
          : '<label>Usuario<input name="username" autocomplete="username" required autofocus /></label>'}
        <label>Contraseña<input name="password" type="password" autocomplete="current-password" required /></label>
        ${provider === 'ctp' ? '<div id="login-captcha"></div>' : ''}
        <p class="gate-error" role="alert">${esc(error)}</p>
        <button class="btn-gold" type="submit" ${provider === 'ctp' ? 'disabled' : ''}>Entrar</button>
      </form>
    </div>`;
  const form = $('#login');
  const button = form.querySelector('button[type="submit"]');
  const errorElement = form.querySelector('.gate-error');
  let captcha = null;
  let busy = false;
  const updateButton = () => { button.disabled = busy || (provider === 'ctp' && !captchaCanSubmit(captcha)); };
  if (provider === 'ctp') loginCaptcha = mountLoginCaptcha($('#login-captcha'), (state) => { captcha = state; updateButton(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (provider === 'ctp' && !captchaCanSubmit(captcha)) {
      errorElement.textContent = captcha?.error || CAPTCHA_MESSAGES.required;
      return;
    }
    const f = new FormData(e.target);
    busy = true;
    errorElement.textContent = '';
    updateButton();
    try {
      const captchaToken = provider === 'ctp' ? loginCaptcha.consume() : '';
      await api('POST', '/auth/login', provider === 'ctp' ? { email: f.get('username'), password: f.get('password'), ...(captchaToken ? { captchaToken } : {}) } : { username: f.get('username'), password: f.get('password') });
      await boot();
    } catch (err) {
      errorElement.textContent = err.message;
      loginCaptcha?.reset();
    } finally {
      busy = false;
      updateButton();
    }
  });
}

function renderSplash() {
  loginCaptcha?.destroy();
  loginCaptcha = null;
  app.innerHTML = `
    <button class="splash" id="enter">
      <span class="partners splash-partners"><img src="/brand/logo-ctp.svg" alt="PlayCTP" /><span class="partners-x">×</span><img src="/ruleta-media/miami-heretics.webp" alt="Miami Heretics" class="partner-logo" /></span>
      <span class="splash-kicker">PlayCTP y Miami Heretics presentan</span>
      <span class="splash-title">La caja<br/>del destino</span>
      <span class="splash-cta">Pulsa para entrar</span>
      <span class="splash-note">Con sonido · ideal a pantalla completa</span>
    </button>`;
  const go = () => {
    audio.init();
    audio.startMusic();
    audio.uiClick();
    window.removeEventListener('keydown', onKey);
    renderStage();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  };
  $('#enter').addEventListener('click', go);
  window.addEventListener('keydown', onKey);
}

function activeCount() {
  return participants.filter((p) => !excluded.has(p.key)).length;
}

function renderStage() {
  app.innerHTML = `
    <div class="letterbox top"></div><div class="letterbox bottom"></div>
    <header class="hud hud-top">
      <div class="brand">
        <img src="/brand/logo-ctp.svg" alt="PlayCTP" />
        <img src="/ruleta-media/miami-heretics-mark.webp" alt="Miami Heretics" class="brand-partner" />
        <div>
          <div class="brand-title">La caja del destino</div>
          <div class="brand-sub">Ruleta oficial PlayCTP</div>
        </div>
      </div>
      <div class="tools">
        <button class="tool" id="btn-people" title="Participantes">${icon.users}<span id="people-count"></span></button>
        <button class="tool" id="btn-history" title="Últimos sorteos">${icon.history}</button>
        <div class="tool sound">
          <button class="tool-inner" id="btn-mute" title="Silenciar (M)">${audio.muted ? icon.mute : icon.sound}</button>
          <input id="vol" type="range" min="0" max="1" step="0.01" value="${audio.volume}" aria-label="Volumen" />
        </div>
        <button class="tool" id="btn-stream" title="Modo stream: oculta la interfaz (H)">${icon.eye}</button>
        <button class="tool" id="btn-full" title="Pantalla completa (F)">${icon.full}</button>
        <button class="tool" id="btn-out" title="Cerrar sesión (${esc(me.name)})">${icon.out}</button>
      </div>
    </header>

    <div class="caption" id="caption" aria-live="polite"></div>
    <div class="ticker" id="ticker"><span></span></div>

    <section class="winner" id="winner" aria-live="assertive">
      <div class="winner-kicker">La caja ha hablado</div>
      <div class="winner-name" id="winner-name"></div>
      <div class="winner-actions hud">
        <button class="btn-gold" id="btn-again">Otra vez</button>
      </div>
    </section>

    <footer class="hud hud-bottom">
      <button class="spin" id="spin">
        <span class="spin-glow"></span>
        <span class="spin-label">Abrir la caja</span>
      </button>
      <div class="hint">Espacio para girar · H oculta la interfaz · F pantalla completa</div>
    </footer>

    <aside class="drawer" id="drawer-people" aria-label="Participantes">
      <div class="drawer-head">
        <h2>Participantes</h2>
        <button class="tool" data-close>${icon.close}</button>
      </div>
      <p class="muted small" id="roster-info"></p>
      <p class="muted small">Desmarca a quien no deba entrar en este sorteo.</p>
      <input class="search" id="people-search" placeholder="Buscar…" />
      <div class="drawer-actions">
        <button class="link" id="all-on">Todos</button>
        <button class="link" id="only-players">Solo jugadores</button>
        <button class="link" id="all-off">Ninguno</button>
      </div>
      <ul class="people" id="people-list"></ul>
    </aside>

    <aside class="drawer" id="drawer-history" aria-label="Últimos sorteos">
      <div class="drawer-head">
        <h2>Últimos sorteos</h2>
        <button class="tool" data-close>${icon.close}</button>
      </div>
      <ul class="history" id="history-list"><li class="muted">Cargando…</li></ul>
    </aside>
    <div class="toast" id="toast"></div>`;

  if (!stage) startStage();
  wireStage();
  updateCount();
}

let stageLoading = null;
function startStage() {
  // Three.js se carga aparte para que el login aparezca al instante.
  stageLoading ||= Promise.all([import('./scene.js'), document.fonts.load('800 64px "Saira Condensed"')]).then(([mod]) => {
    stage = new mod.Stage(canvas, audio);
    stage.onCue = onCue;
    const qs = new URLSearchParams(location.search);
    if (qs.has('debug')) {
      // Solo para pruebas automáticas: avanza la escena a saltos fijos.
      window.__stage = stage;
      if (qs.get('step')) stage.fixedStep = Number(qs.get('step'));
    }
    document.body.classList.add('ready');
    return stage;
  });
  return stageLoading;
}

function updateCount() {
  const el = $('#people-count');
  if (el) el.textContent = activeCount();
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function openDrawer(id) {
  for (const d of app.querySelectorAll('.drawer')) d.classList.toggle('open', d.id === id && !d.classList.contains('open'));
}

function renderPeople() {
  const q = ($('#people-search')?.value || '').toLowerCase();
  const list = $('#people-list');
  list.innerHTML = participants
    .filter((p) => p.name.toLowerCase().includes(q))
    .map(
      (p) => `<li><label><input type="checkbox" data-key="${esc(p.key)}" ${excluded.has(p.key) ? '' : 'checked'} /><span>${esc(p.name)}</span>${p.role && p.role !== 'player' ? `<em class="role">${roleLabel(p)}</em>` : ''}</label></li>`,
    )
    .join('') || '<li class="muted">Nadie con ese nombre.</li>';
}

async function renderHistory() {
  const list = $('#history-list');
  try {
    const draws = await api('GET', '/ruleta/draws');
    list.innerHTML = draws.length
      ? draws
          .map((d) => {
            const when = new Date(d.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
            return `<li><strong>${esc(d.winner.name)}</strong><span class="muted small">${when} · ${d.participant_count} en el bombo${d.drawn_by ? ` · por ${esc(d.drawn_by)}` : ''}</span></li>`;
          })
          .join('')
      : '<li class="muted">Aún no hay sorteos.</li>';
  } catch (err) {
    if (err.status === 401) return renderLogin('Tu sesión ha caducado. Vuelve a entrar.');
    list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
}

function setStreamMode(on) {
  document.body.classList.toggle('stream', on);
  if (on) toast('Modo stream: pulsa H para ver la interfaz');
}

function wireStage() {
  $('#spin').addEventListener('click', spin);
  $('#btn-again').addEventListener('click', again);
  $('#btn-people').addEventListener('click', () => {
    renderPeople();
    renderRosterInfo();
    openDrawer('drawer-people');
  });
  $('#btn-history').addEventListener('click', () => {
    renderHistory();
    openDrawer('drawer-history');
  });
  for (const b of app.querySelectorAll('[data-close]')) b.addEventListener('click', () => openDrawer(null));
  $('#people-search').addEventListener('input', renderPeople);
  $('#people-list').addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    if (e.target.checked) excluded.delete(key);
    else excluded.add(key);
    saveExcluded();
    updateCount();
  });
  $('#all-on').addEventListener('click', () => {
    excluded.clear();
    saveExcluded();
    renderPeople();
    updateCount();
  });
  $('#all-off').addEventListener('click', () => {
    excluded = new Set(participants.map((p) => p.key));
    saveExcluded();
    renderPeople();
    updateCount();
  });
  $('#only-players').addEventListener('click', () => {
    excluded = new Set(participants.filter((p) => p.role && p.role !== 'player').map((p) => p.key));
    saveExcluded();
    renderPeople();
    updateCount();
  });
  $('#btn-mute').addEventListener('click', toggleMute);
  $('#vol').addEventListener('input', (e) => {
    audio.setVolume(Number(e.target.value));
    if (audio.muted) toggleMute();
  });
  $('#btn-stream').addEventListener('click', () => setStreamMode(!document.body.classList.contains('stream')));
  $('#btn-full').addEventListener('click', toggleFull);
  $('#btn-out').addEventListener('click', async () => {
    await api('POST', '/auth/logout').catch(() => {});
    location.reload();
  });
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  const b = $('#btn-mute');
  if (b) b.innerHTML = audio.muted ? icon.mute : icon.sound;
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

window.addEventListener('keydown', (e) => {
  if (!stage || e.target.closest?.('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') {
    e.preventDefault();
    if (document.body.classList.contains('show-winner')) again();
    else spin();
  } else if (k === 'h') setStreamMode(!document.body.classList.contains('stream'));
  else if (k === 'f') toggleFull();
  else if (k === 'm') toggleMute();
  else if (k === 'escape') openDrawer(null);
});

// ---------- el sorteo ----------

async function spin() {
  if (drawing) return;
  if (!participants.length && roster?.error) {
    toast(roster.error);
    return;
  }
  if (!activeCount()) {
    toast('No hay nadie en el sorteo: elige participantes.');
    return;
  }
  drawing = true;
  audio.init();
  audio.uiClick();
  openDrawer(null);
  let result;
  try {
    await startStage();
    result = await api('POST', '/ruleta/draw', { excluded: [...excluded].filter((k) => participants.some((p) => p.key === k)) });
  } catch (err) {
    drawing = false;
    if (err.status === 401) return renderLogin('Tu sesión ha caducado. Vuelve a entrar.');
    toast(err.message);
    return;
  }
  document.body.classList.add('drawing');
  await stage.playDraw(result);
}

function again() {
  if (!stage) return;
  document.body.classList.remove('show-winner', 'drawing', 'cycling', 'can-again');
  $('#ticker').classList.remove('locked');
  stage.reset();
  drawing = false;
  // Por si alguien se ha dado de alta o de baja mientras tanto.
  reloadRoster();
}

// Los permisos de staff se cambian en Manager en cualquier momento: la lista se
// relee cada poco y al volver a la pestaña, nunca en mitad de un sorteo.
function reloadRoster() {
  if (drawing) return;
  api('GET', '/ruleta/participants')
    .then((data) => {
      if (drawing) return;
      applyRoster(data);
      updateCount();
      if ($('#drawer-people')?.classList.contains('open')) {
        renderPeople();
        renderRosterInfo();
      }
    })
    .catch(() => {});
}

function watchRoster() {
  setInterval(reloadRoster, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reloadRoster();
  });
}

function onCue(name, data) {
  const caption = $('#caption');
  const ticker = $('#ticker');
  if (!caption) return;
  switch (name) {
    case 'caption':
      caption.classList.remove('show');
      if (data) {
        void caption.offsetWidth;
        caption.textContent = data;
        caption.classList.add('show');
      }
      break;
    case 'cycle-start':
      document.body.classList.add('cycling');
      break;
    case 'cycle':
      ticker.firstElementChild.textContent = data;
      ticker.classList.remove('bump');
      void ticker.offsetWidth;
      ticker.classList.add('bump');
      break;
    case 'lock':
      ticker.firstElementChild.textContent = '· · ·';
      ticker.classList.add('locked');
      break;
    case 'reveal': {
      document.body.classList.remove('cycling');
      const el = $('#winner-name');
      el.innerHTML = [...data.name].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
      document.body.classList.add('show-winner');
      break;
    }
    case 'done':
      document.body.classList.remove('drawing');
      document.body.classList.add('can-again');
      break;
    default:
  }
}

function applyRoster(data) {
  participants = Array.isArray(data?.people) ? data.people : [];
  roster = data || null;
}

function renderRosterInfo() {
  const el = $('#roster-info');
  if (!el) return;
  if (roster?.error) {
    el.textContent = roster.error;
    return;
  }
  if (!roster) return;
  const when = roster.refreshed_at ? new Date(roster.refreshed_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  el.textContent = roster.source === 'ctp'
    ? `${participants.length.toLocaleString('es-ES')} personas registradas en PlayCTP · se actualiza sola (última lectura: ${when})${roster.truncated ? ' (recortada)' : ''}${roster.warning ? ` · ${roster.warning}` : ''}`
    : `${participants.length} usuarios del Manager (modo local, sin conexión con CTP).`;
}

// ---------- arranque ----------

async function boot() {
  startStage();
  let status;
  try {
    status = await api('GET', '/auth/status');
  } catch {
    app.innerHTML = '<div class="gate"><div class="gate-card"><h1>Sin conexión</h1><p class="muted">No se puede conectar con el servidor de PlayCTP. Recarga la página en un momento.</p></div></div>';
    return;
  }
  provider = status.provider || 'local';
  if (!status.authenticated) return renderLogin();
  me = status.user;
  try {
    applyRoster(await api('GET', '/ruleta/participants'));
  } catch (err) {
    if (err.status === 401) return renderLogin();
    participants = [];
    roster = { error: err.message };
  }
  watchRoster();
  renderSplash();
}

boot();
