import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ctpAuthConfig, publicCtpAuthConfig } from '../server/ctp-auth.js';

const anonymous = `e30.${Buffer.from('{"role":"anon","exp":4102444800}').toString('base64url')}.fixture`;
const base = { CTP_AUTH_MODE:'ctp', CTP_DEV_LOCAL_AUTH:'true',
  CTP_AUTH_URL:'http://127.0.0.1:58080', CTP_WEB_ORIGIN:'http://127.0.0.1:58080',
  CTP_OPERATIONS_URL:'http://127.0.0.1:58080/functions/v1/manager-operations',
  CTP_AUTH_ANON_KEY:anonymous, CTP_AUTH_TOKEN_KEY:crypto.randomBytes(32).toString('base64url') };
const environment = origin => ({...base, CTP_AUTH_URL:origin, CTP_WEB_ORIGIN:origin,
  CTP_OPERATIONS_URL:origin+'/functions/v1/manager-operations'});

test('shared DEV auth needs an explicit opt-in and one canonical loopback origin with a port',()=>{
  for (const host of ['127.0.0.1','localhost','[::1]']) {
    const origin=`http://${host}:58080`, config=ctpAuthConfig(environment(origin));
    assert.equal(config.origin,origin);assert.equal(config.mode,'ctp');
    assert.deepEqual(publicCtpAuthConfig(config),{provider:'ctp',captcha:{required:false,siteKey:null}});
  }
  assert.equal(ctpAuthConfig(environment('http://127.0.0.1:65535')).origin,'http://127.0.0.1:65535');
  for (const CTP_DEV_LOCAL_AUTH of [undefined,'false','',true,'1','TRUE']) {
    assert.throws(()=>ctpAuthConfig({...base,CTP_DEV_LOCAL_AUTH}));
  }
  assert.throws(()=>ctpAuthConfig({...base,CTP_AUTH_MODE:'local'}));
});

test('DEV auth never accepts public deployments, remote targets or normalized loopback spellings',()=>{
  for (const origin of [
    'https://pre.playctp.com','https://playctp.com','http://192.168.1.2:58080','http://0.0.0.0:58080',
    'http://127.0.0.2:58080','http://127.1:58080','http://2130706433:58080','http://0x7f000001:58080',
    'http://127.0.0.1','http://127.0.0.1:0','http://127.0.0.1:65536','http://127.0.0.1:058080',
    'http://127.0.0.1:58080/','http://127.0.0.1:58080/path','http://127.0.0.1:58080?key=x','http://127.0.0.1:58080#x',
    'http://user:password@127.0.0.1:58080','http://localhost.:58080','http://LOCALHOST:58080',
    'http://localhost.example.invalid:58080','https://localhost:58080','http://[0:0:0:0:0:0:0:1]:58080',
  ]) assert.throws(()=>ctpAuthConfig(environment(origin)),origin);
  for (const PUBLIC_ORIGIN of ['https://pre.manager.playctp.com','https://manager.playctp.com','http://localhost:58081']) {
    assert.throws(()=>ctpAuthConfig({...base,PUBLIC_ORIGIN}));
  }
});

test('DEV keeps origin matching, independent credentials and staff-only protocol validation',()=>{
  for (const override of [
    {CTP_WEB_ORIGIN:'http://127.0.0.1:5181'}, {CTP_AUTH_URL:'http://localhost:58080'},
    {CTP_OPERATIONS_URL:'http://localhost:58080/functions/v1/manager-operations'},
    {CTP_OPERATIONS_URL:base.CTP_OPERATIONS_URL+'?key=x'},
    {CTP_OPERATIONS_URL:'http://127.0.0.1:58080/another-bridge'},
    {CTP_OPERATIONS_URL:'http://user:password@127.0.0.1:58080/functions/v1/manager-operations'},
    {CTP_AUTH_ANON_KEY:`e30.${Buffer.from('{"role":"service_role","exp":4102444800}').toString('base64url')}.fixture`},
    {CTP_AUTH_TOKEN_KEY:'weak'}, {CTP_SIGNING_SECRET:base.CTP_AUTH_TOKEN_KEY},
  ]) assert.throws(()=>ctpAuthConfig({...base,...override}));
  for (const origin of ['https://pre.playctp.com','https://playctp.com']) {
    const hosted={...environment(origin),CTP_DEV_LOCAL_AUTH:'false',PUBLIC_ORIGIN:origin==='https://pre.playctp.com'?'https://pre.manager.playctp.com':'https://manager.playctp.com'};
    assert.equal(ctpAuthConfig(hosted).origin,origin);
    assert.equal(ctpAuthConfig({...hosted,CTP_DEV_LOCAL_AUTH:undefined}).origin,origin);
    assert.throws(()=>ctpAuthConfig({...hosted,CTP_DEV_LOCAL_AUTH:'true'}));
  }
});
