import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, tweetLength } from '../shared/tweet.js';

test('cuenta caracteres como X', () => {
  assert.equal(tweetLength('hola'), 4);
  assert.equal(tweetLength('¡Qué tal, señor!'), 16);
  assert.equal(tweetLength('👍'), 2);
  assert.equal(tweetLength('👍🏽'), 2);
  assert.equal(tweetLength('👨‍👩‍👧‍👦'), 2);
  assert.equal(tweetLength('🇪🇸'), 2);
  assert.equal(tweetLength('日本'), 4);
});

test('los enlaces cuentan 23 caracteres', () => {
  assert.equal(tweetLength('mira https://example.com/una/ruta/muy/larga/de/verdad'), 5 + 23);
  assert.equal(tweetLength('visita x.com.'), 7 + 23 + 1);
  assert.equal(tweetLength('yo@correo.com'), 13);
  assert.deepEqual(extractUrls('(ver www.ejemplo.com)').map((u) => u.url), ['www.ejemplo.com']);
  assert.equal(extractUrls('Son las 10.30 y el precio es 3.5').length, 0);
});
