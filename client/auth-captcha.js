export const CAPTCHA_MESSAGES = Object.freeze({
  loading: 'Cargando la verificación de seguridad…',
  required: 'Completa la verificación de seguridad para entrar.',
  expired: 'La verificación ha caducado. Complétala de nuevo.',
  unavailable: 'No se puede cargar la verificación de seguridad. Reinténtalo.',
});

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise;

export function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    const timeout = setTimeout(() => finish(false), 15000);
    function finish(ok) {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (ok && window.turnstile?.render) resolve(window.turnstile);
      else {
        script.remove();
        reject(new Error(CAPTCHA_MESSAGES.unavailable));
      }
    }
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

export const validCaptchaToken = (token) => typeof token === 'string' && token.length > 0 && token.length <= 2048 && !/\s/.test(token);
export const captchaCanSubmit = (state) => Boolean(state && !state.loading && !state.error && (!state.required || validCaptchaToken(state.token)));

async function publicConfig() {
  const response = await fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(CAPTCHA_MESSAGES.unavailable);
  return response.json();
}

// Shared by the React Manager and the standalone ruleta login. Tokens stay in
// memory and are consumed before the request: a failed request needs a new one.
export function createLoginCaptcha({ element, onChange, expectedProvider = 'ctp', fetchConfig = publicConfig, loadApi = loadTurnstile, schedule = setTimeout, cancel = clearTimeout }) {
  let active = true;
  let generation = 0;
  let api;
  let widget;
  let expiry;
  let state = { loading: true, required: true, token: '', error: '' };
  const update = (patch) => {
    if (!active) return;
    state = { ...state, ...patch };
    onChange({ ...state });
  };
  const clearExpiry = () => {
    if (expiry !== undefined) cancel(expiry);
    expiry = undefined;
  };
  function removeWidget() {
    clearExpiry();
    if (api && widget !== undefined) {
      try { api.remove(widget); } catch { /* Already removed by the provider. */ }
    }
    widget = undefined;
  }
  async function retry() {
    if (!active) return;
    const current = ++generation;
    removeWidget();
    update({ loading: true, required: true, token: '', error: '' });
    const currentAttempt = () => active && current === generation;
    try {
      const config = await fetchConfig();
      if (!currentAttempt()) return;
      // The caller selects its provider, never the unauthenticated response.
      // A CTP form must not become a local/no-CAPTCHA form on a config mismatch.
      if (!['ctp', 'local'].includes(expectedProvider) || !config || typeof config !== 'object' || Array.isArray(config)
        || config.provider !== expectedProvider || !config.captcha || typeof config.captcha !== 'object' || Array.isArray(config.captcha)
        || typeof config.captcha.required !== 'boolean') throw new Error('invalid_config');
      const siteKey = config.captcha.siteKey;
      if (config.provider === 'local') {
        if (config.captcha.required || siteKey !== null) throw new Error('invalid_local_config');
      } else if ((siteKey !== null && (typeof siteKey !== 'string' || !/^[a-zA-Z0-9_-]{10,100}$/.test(siteKey)))
        || config.captcha.required && !siteKey) throw new Error('invalid_sitekey');
      if (!config.captcha.required) {
        update({ loading: false, required: false });
        return;
      }
      const loadedApi = await loadApi();
      if (!currentAttempt()) return;
      api = loadedApi;
      const invalidate = (message) => {
        if (!currentAttempt()) return;
        clearExpiry();
        update({ loading: false, token: '', error: message });
      };
      widget = api.render(element, {
        sitekey: siteKey, theme: 'dark', size: element.clientWidth > 0 && element.clientWidth < 300 ? 'compact' : 'flexible', language: 'es',
        'response-field': false, retry: 'never', 'refresh-expired': 'manual', 'refresh-timeout': 'manual',
        callback: (token) => {
          if (!currentAttempt()) return;
          if (!validCaptchaToken(token)) return invalidate(CAPTCHA_MESSAGES.unavailable);
          clearExpiry();
          update({ loading: false, token, error: '' });
          // Invalidate before Cloudflare's five-minute lifetime even if its
          // expiry callback is delayed while the page is in the background.
          expiry = schedule(() => invalidate(CAPTCHA_MESSAGES.expired), 270000);
        },
        'expired-callback': () => invalidate(CAPTCHA_MESSAGES.expired),
        'timeout-callback': () => invalidate(CAPTCHA_MESSAGES.expired),
        'error-callback': () => { invalidate(CAPTCHA_MESSAGES.unavailable); return true; },
        'unsupported-callback': () => invalidate(CAPTCHA_MESSAGES.unavailable),
      });
      if (widget === undefined || widget === null) throw new Error('widget_unavailable');
      update({ loading: false });
    } catch {
      if (currentAttempt()) update({ loading: false, token: '', error: CAPTCHA_MESSAGES.unavailable });
    }
  }
  const ready = retry();
  return {
    ready,
    retry,
    consume() {
      if (!captchaCanSubmit(state)) throw new Error(state.error || CAPTCHA_MESSAGES.required);
      const token = state.token;
      clearExpiry();
      update({ token: '' });
      return token;
    },
    reset() {
      if (!active || !state.required) return;
      clearExpiry();
      update({ token: '', error: '' });
      if (!api || widget === undefined) return retry();
      try { api.reset(widget); }
      catch { update({ error: CAPTCHA_MESSAGES.unavailable }); }
    },
    destroy() {
      active = false;
      generation++;
      state = { loading: true, required: true, token: '', error: '' };
      removeWidget();
    },
  };
}

export function mountLoginCaptcha(container, onChange, { expectedProvider = 'ctp' } = {}) {
  const section = document.createElement('div');
  section.className = 'auth-captcha';
  const label = document.createElement('span');
  label.className = 'auth-captcha-label';
  label.textContent = 'Verificación de seguridad';
  const widget = document.createElement('div');
  widget.className = 'auth-captcha-widget';
  const status = document.createElement('p');
  status.className = 'auth-captcha-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'auth-captcha-retry';
  retry.textContent = 'Reintentar verificación';
  retry.hidden = true;
  section.append(label, widget, status, retry);
  container.replaceChildren(section);
  const controller = createLoginCaptcha({ element: widget, expectedProvider, onChange: (state) => {
    section.hidden = !state.loading && !state.required;
    status.textContent = state.error || (state.loading ? CAPTCHA_MESSAGES.loading : state.token ? '' : CAPTCHA_MESSAGES.required);
    retry.hidden = !state.error;
    onChange(state);
  } });
  retry.addEventListener('click', () => controller.retry());
  let compact = widget.clientWidth > 0 && widget.clientWidth < 300;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!widget.clientWidth) return;
    const nextCompact = widget.clientWidth < 300;
    if (nextCompact !== compact) {
      compact = nextCompact;
      controller.retry();
    }
  }) : null;
  observer?.observe(widget);
  return { ...controller, destroy() { observer?.disconnect(); controller.destroy(); } };
}
