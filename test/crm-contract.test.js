import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-crm-'));
Object.assign(process.env, { DATA_DIR: directory, DB_PATH: path.join(directory, 'manager.sqlite'), CTP_OPERATIONS_URL: '', CTP_OPERATIONS_TOKEN: '', PUBLIC_ORIGIN: '' });
const { CRM_ACTIONS, CRM_READ_ACTIONS, CRM_WRITE_ACTIONS, crmRequest, crmIsRead } = await import('../server/crm-contract.js');
const { crmAction } = await import('../server/crm.js');
const { integrationConfig, createOperationsTransport } = await import('../server/integration.js');
const { db } = await import('../server/db.js');
after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const token = 'ctp-test-secret-is-only-on-server-0123456789';
const signingSecret = 'ctp-independent-signing-test-secret-0123456789';

test('el CRM solo admite acciones del catálogo y separa lecturas de escrituras', () => {
  assert.equal(new Set(CRM_ACTIONS).size, CRM_READ_ACTIONS.length + CRM_WRITE_ACTIONS.length);
  assert.deepEqual(crmRequest({ action: 'contacts', data: { filters: {} } }), { action: 'contacts', data: { filters: {} } });
  assert.equal(crmIsRead('contacts'), true); assert.equal(crmIsRead('campaign.schedule'), false);
  for (const input of [{ action: 'drop' }, { action: 'contacts', data: [] }, { action: 'contacts', extra: 1 }, null, 'x']) assert.throws(() => crmRequest(input), { status: 400 });
  assert.throws(() => crmRequest({ action: 'test.send', data: { email: 'no-es-correo' } }), { status: 400 });
  assert.throws(() => crmRequest({ action: 'campaign.schedule', data: { id: 'a', confirm_id: 'b' } }), { status: 400 });
  assert.throws(() => crmRequest({ action: 'campaign.save', data: { html: 'x'.repeat(2_000_000) } }), { status: 413 });
});

test('solo administración CTP accede al CRM', async () => {
  await assert.rejects(crmAction(null, { action: 'overview' }), { status: 401 });
  await assert.rejects(crmAction({ id: 1, is_admin: false }, { action: 'overview' }), { status: 403 });
  await assert.rejects(crmAction({ id: 1, is_admin: true, auth_mode: 'ctp', ctp_role: 'referee' }, { action: 'overview' }), { status: 403 });
});

test('los errores del CRM usan mensajes propios y nunca reenvían texto remoto', async () => {
  const config = integrationConfig({ CTP_OPERATIONS_URL: 'https://example.test/bridge', CTP_OPERATIONS_TOKEN: token, CTP_SIGNING_SECRET: signingSecret });
  const body = { action: 'admin_service', service: 'crm', payload: { action: 'campaign.save' } };
  const invoke = (payload, status = 422) => createOperationsTransport(config, async () => Response.json(payload, { status }))(body);
  await assert.rejects(invoke({ code: 'crm_error', crm_error: 'crm_empty_audience', secret: token }), error => error.status === 422 && error.message.includes('consentimiento') && !error.message.includes(token));
  await assert.rejects(invoke({ code: 'conflict', crm_error: 'crm_version_conflict' }, 409), error => error.status === 409 && error.message.includes('Vuelve a cargarla'));
  await assert.rejects(invoke({ code: 'crm_error', crm_error: token }), error => error.status === 422 && !error.message.includes(token));
});
