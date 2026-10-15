import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { signManagerRequest, MANAGER_ORIGIN, BRIDGE_PATH } from '../server/bridge-signature.js';

test('la firma liga los bytes exactos, audiencia, método y ruta del servicio', () => {
  const secret='test-signing-only-not-a-real-key-0123456789';
  const body=JSON.stringify({action:'command',payload:{reason:'Revisión castellana'}});
  const timestamp=1790934000, nonce='b712aa64-ab0e-4e80-838e-af0d5ab558a4';
  const signed=signManagerRequest(body,secret,{timestamp,nonce});
  const canonical=['v1',String(timestamp),nonce,'https://manager.playctp.com','POST','/functions/v1/manager-operations',createHash('sha256').update(body).digest('hex')].join('\n');
  assert.equal(signed['X-CTP-Signature'],createHmac('sha256',secret).update(canonical).digest('hex'));
  assert.equal(signed['X-CTP-Manager-Origin'],MANAGER_ORIGIN);
  assert.equal(BRIDGE_PATH,'/functions/v1/manager-operations');
  assert.notEqual(signManagerRequest(body+' ',secret,{timestamp,nonce})['X-CTP-Signature'],signed['X-CTP-Signature']);
  assert.notEqual(signManagerRequest(body,secret,{timestamp:timestamp+1,nonce})['X-CTP-Signature'],signed['X-CTP-Signature']);
  assert.notEqual(signManagerRequest(body,secret,{timestamp,nonce:nonce+'a'})['X-CTP-Signature'],signed['X-CTP-Signature']);
  assert.equal(JSON.stringify(signed).includes(secret),false);
  assert.equal(signed.Origin,undefined);
});

test('cada reintento usa nonce distinto y exige un secreto de firma', () => {
  const secret='test-signing-only-not-a-real-key-0123456789';
  assert.notEqual(signManagerRequest('{}',secret)['X-CTP-Nonce'],signManagerRequest('{}',secret)['X-CTP-Nonce']);
  for(const invalid of ['',undefined,'weak',' '.repeat(40)])assert.throws(()=>signManagerRequest('{}',invalid));
});
