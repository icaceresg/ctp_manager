import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTCHA_MESSAGES, captchaCanSubmit, createLoginCaptcha, loadTurnstile, validCaptchaToken } from '../client/auth-captcha.js';

const configured = { provider: 'ctp', captcha: { required: true, siteKey: 'public-test-sitekey' } };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(overrides = {}) {
  const events = [];
  const timers = new Map();
  const removed = [];
  const resets = [];
  const widgets = [];
  let loads = 0;
  let timerId = 0;
  const api = {
    render(element, options) { widgets.push({ element, options }); return widgets.length - 1; },
    reset(id) { resets.push(id); },
    remove(id) { removed.push(id); },
  };
  const controller = createLoginCaptcha({
    element: { clientWidth: 320 },
    onChange: (state) => events.push(state),
    fetchConfig: async () => structuredClone(configured),
    loadApi: async () => { loads++; return api; },
    schedule: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    cancel: (id) => timers.delete(id),
    ...overrides,
  });
  return { controller, events, timers, removed, resets, widgets, api, get loads() { return loads; }, state: () => events.at(-1) };
}

test('CTP stays closed while config is loading and never loads Cloudflare when disabled', async () => {
  const config = deferred();
  const h = harness({ fetchConfig: () => config.promise });
  assert.equal(captchaCanSubmit(h.state()), false);
  assert.throws(() => h.controller.consume(), /verificación/);
  config.resolve({ provider: 'ctp', captcha: { required: false, siteKey: null } });
  await h.controller.ready;
  assert.equal(captchaCanSubmit(h.state()), true);
  assert.equal(h.loads, 0);
  assert.equal(h.controller.consume(), '');
  h.controller.destroy();
});

test('missing, malformed or unavailable public configuration fails closed', async () => {
  for (const config of [null, { provider: 'local', captcha: { required: false } }, { provider: 'ctp', captcha: {} },
    { provider: 'ctp', captcha: { required: true, siteKey: null } },
    { provider: 'ctp', captcha: { required: true, siteKey: 'https://untrusted.example' } }]) {
    const h = harness({ fetchConfig: async () => config });
    await h.controller.ready;
    assert.equal(captchaCanSubmit(h.state()), false);
    assert.equal(h.loads, 0);
    assert.equal(h.state().error, CAPTCHA_MESSAGES.unavailable);
    h.controller.destroy();
  }
  const h = harness({ fetchConfig: async () => { throw new Error('network'); } });
  await h.controller.ready;
  assert.equal(captchaCanSubmit(h.state()), false);
  h.controller.destroy();
});

test('blocked Cloudflare script and failed render cannot permit a login', async () => {
  for (const loadApi of [async () => { throw new Error('CSP or network'); }, async () => ({ render: () => undefined })]) {
    const h = harness({ loadApi });
    await h.controller.ready;
    assert.equal(captchaCanSubmit(h.state()), false);
    assert.equal(h.state().error, CAPTCHA_MESSAGES.unavailable);
    h.controller.destroy();
  }
});

test('explicit widget receives public key and valid token is consumed only once', async () => {
  const h = harness();
  await h.controller.ready;
  const options = h.widgets[0].options;
  assert.equal(options.sitekey, configured.captcha.siteKey);
  assert.equal(options['response-field'], false);
  assert.equal(options.size, 'flexible');
  assert.equal(captchaCanSubmit(h.state()), false);
  options.callback('single-use-test-token');
  assert.equal(captchaCanSubmit(h.state()), true);
  assert.equal(h.controller.consume(), 'single-use-test-token');
  assert.equal(captchaCanSubmit(h.state()), false);
  assert.throws(() => h.controller.consume(), /verificación/);
  assert.equal(h.timers.size, 0);
  h.controller.destroy();
});

test('invalid, oversized and whitespace tokens stay unusable', async () => {
  const h = harness();
  await h.controller.ready;
  for (const token of ['', null, 1, 'a'.repeat(2049), 'a b', 'a\nb', 'a\u2028b']) {
    assert.equal(validCaptchaToken(token), false);
    h.widgets[0].options.callback(token);
    assert.equal(captchaCanSubmit(h.state()), false);
  }
  h.controller.destroy();
});

test('expiry, timeout, unsupported browser and challenge error invalidate prior success', async () => {
  for (const event of ['expired-callback', 'timeout-callback', 'error-callback', 'unsupported-callback']) {
    const h = harness();
    await h.controller.ready;
    const options = h.widgets[0].options;
    options.callback('fresh-test-token');
    assert.equal(captchaCanSubmit(h.state()), true);
    options[event]('provider-error-code');
    assert.equal(captchaCanSubmit(h.state()), false);
    assert.equal(h.state().token, '');
    assert.ok(h.state().error);
    assert.equal(h.timers.size, 0);
    h.controller.destroy();
  }
});

test('local lifetime guard expires a token before its five-minute server lifetime', async () => {
  const h = harness();
  await h.controller.ready;
  h.widgets[0].options.callback('fresh-test-token');
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 270000);
  timer.callback();
  assert.equal(h.state().error, CAPTCHA_MESSAGES.expired);
  assert.equal(captchaCanSubmit(h.state()), false);
  h.controller.destroy();
});

test('reset after a failed attempt discards the used token and requires a new challenge', async () => {
  const h = harness();
  await h.controller.ready;
  h.widgets[0].options.callback('first-test-token');
  h.controller.consume();
  h.controller.reset();
  assert.deepEqual(h.resets, [0]);
  assert.equal(captchaCanSubmit(h.state()), false);
  h.widgets[0].options.callback('second-test-token');
  assert.equal(h.controller.consume(), 'second-test-token');
  h.controller.destroy();
});

test('retry ignores old async config results', async () => {
  const stale = deferred();
  let calls = 0;
  const h = harness({ fetchConfig: () => ++calls === 1 ? stale.promise : Promise.resolve(configured) });
  await h.controller.retry();
  h.widgets[0].options.callback('current-test-token');
  stale.resolve({ provider: 'ctp', captcha: { required: false, siteKey: null } });
  await h.controller.ready;
  assert.equal(h.state().required, true);
  assert.equal(h.controller.consume(), 'current-test-token');
  h.controller.destroy();
});

test('retry recovers from temporary config failure without bypassing the challenge', async () => {
  let calls = 0;
  const h = harness({ fetchConfig: async () => {
    if (++calls === 1) throw new Error('offline');
    return configured;
  } });
  await h.controller.ready;
  assert.equal(captchaCanSubmit(h.state()), false);
  await h.controller.retry();
  assert.equal(h.state().error, '');
  assert.equal(captchaCanSubmit(h.state()), false);
  h.widgets[0].options.callback('new-test-token');
  assert.equal(captchaCanSubmit(h.state()), true);
  h.controller.destroy();
});

test('unmount removes its widget and rejects late callbacks or config results', async () => {
  const h = harness();
  await h.controller.ready;
  h.controller.destroy();
  assert.deepEqual(h.removed, [0]);
  const count = h.events.length;
  h.widgets[0].options.callback('late-test-token');
  assert.equal(h.events.length, count);
  assert.throws(() => h.controller.consume(), /verificación/);
  await h.controller.retry();
  assert.equal(h.widgets.length, 1);
  const config = deferred();
  const other = harness({ fetchConfig: () => config.promise });
  other.controller.destroy();
  config.resolve(configured);
  await other.controller.ready;
  assert.equal(other.loads, 0);
});

test('small login containers render the compact widget instead of overflowing the form', async () => {
  const h = harness({ element: { clientWidth: 260 } });
  await h.controller.ready;
  assert.equal(h.widgets[0].options.size, 'compact');
  h.controller.destroy();
});

test('script loader shares one exact Cloudflare request and retries after a failed load', async () => {
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const scripts = [];
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { append: (script) => scripts.push(script) },
  };
  try {
    const failed = loadTurnstile();
    assert.equal(loadTurnstile(), failed);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    scripts[0].onerror();
    await assert.rejects(failed, /verificación/);
    assert.equal(scripts[0].removed, true);
    const recovered = loadTurnstile();
    assert.equal(scripts.length, 2);
    window.turnstile = { render() {} };
    scripts[1].onload();
    assert.equal(await recovered, window.turnstile);
    assert.equal(await loadTurnstile(), window.turnstile);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});
