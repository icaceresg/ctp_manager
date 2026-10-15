import { createHash, createHmac, randomUUID } from 'node:crypto';

export const MANAGER_ORIGIN = 'https://manager.playctp.com';
export const BRIDGE_PATH = '/functions/v1/manager-operations';

// Sign the exact bytes sent. The public Edge path is canonical even behind its proxy.
export function signManagerRequest(body, secret, { timestamp = Math.floor(Date.now() / 1000), nonce = randomUUID() } = {}) {
  if (typeof secret !== 'string' || secret.length < 32 || /\s/.test(secret)) throw new Error('Falta una clave de firma válida del servidor.');
  const time = String(timestamp);
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = ['v1', time, nonce, MANAGER_ORIGIN, 'POST', BRIDGE_PATH, digest].join('\n');
  return {
    'X-CTP-Manager-Origin': MANAGER_ORIGIN,
    'X-CTP-Timestamp': time,
    'X-CTP-Nonce': nonce,
    'X-CTP-Signature': createHmac('sha256', secret).update(canonical, 'utf8').digest('hex'),
  };
}
