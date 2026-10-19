import { HttpError } from './auth.js';

/* CRM de comunicaciones: solo administración CTP. CTP valida de nuevo cada campo. */
export const CRM_READ_ACTIONS = Object.freeze(['overview','contacts','audience','segments','campaigns','campaign','campaign.recipients','test.status','templates','template']);
export const CRM_WRITE_ACTIONS = Object.freeze(['segment.save','segment.delete','campaign.save','campaign.duplicate','campaign.delete','campaign.schedule','campaign.unschedule','campaign.cancel','campaign.winner','test.send','template.save','template.reset']);
export const CRM_ACTIONS = Object.freeze([...CRM_READ_ACTIONS,...CRM_WRITE_ACTIONS]);
const MAX_BYTES = 1_900_000;

/** Mensajes de los códigos semánticos de CTP; nunca se reenvía texto remoto. */
export const CRM_ERRORS = Object.freeze({
  crm_invalid_filters:'Los filtros de audiencia no son válidos.',
  crm_invalid_content:'Revisa el contenido: el asunto es obligatorio (máximo 200 caracteres) y el cuerpo no puede estar vacío.',
  crm_invalid_merge_tag:'Hay etiquetas {{…}} no admitidas. Usa solo las variables que ofrece el editor.',
  crm_default_locale_missing:'Cada variante necesita contenido en el idioma por defecto.',
  crm_invalid_variants:'Las variantes A/B no son válidas. En modo A/B ambas variantes necesitan contenido.',
  crm_content_too_large:'El contenido de la campaña es demasiado grande. Reduce el HTML o usa imágenes enlazadas.',
  crm_invalid_name:'Indica un nombre (máximo 150 caracteres).',
  crm_invalid_link:'El destino debe ser una ruta interna de CTP, por ejemplo /tournaments.',
  crm_not_found:'El registro ya no existe en CTP.',
  crm_limit_reached:'Se ha alcanzado el máximo de registros permitidos.',
  crm_campaign_locked:'La campaña ya no está en un estado que permita esta acción. Actualiza la vista.',
  crm_version_conflict:'La campaña ha cambiado desde que la abriste. Vuelve a cargarla antes de guardar.',
  crm_confirm_required:'Confirma la acción antes de enviarla.',
  crm_invalid_schedule:'La fecha de envío debe estar entre ahora y los próximos 365 días.',
  crm_empty_audience:'No hay ninguna persona con consentimiento comercial y correo confirmado en esta audiencia.',
  crm_invalid_test:'Indica una dirección de correo válida para la prueba.',
  crm_test_rate_limit:'Has alcanzado el límite de 30 envíos de prueba por hora.',
  crm_code_tag_required:'Este correo debe incluir exactamente una vez la variable {{codigo}}.',
  crm_invalid_request:'Solicitud no válida.',
});

const fail = message => { throw new HttpError(400, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Solo una acción del catálogo y un objeto de datos acotado; sin proxy genérico. */
export function crmRequest(input) {
  if (!plain(input) || Object.keys(input).some(key => !['action','data'].includes(key))) fail('Solicitud de CRM no válida.');
  if (!CRM_ACTIONS.includes(input.action)) fail('Acción de CRM no admitida.');
  const data = input.data ?? {};
  if (!plain(data)) fail('Datos de CRM no válidos.');
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BYTES) throw new HttpError(413, 'El contenido supera el tamaño permitido.');
  if (input.action === 'test.send' && (typeof data.email !== 'string' || !/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(data.email) || data.email.length > 254)) fail(CRM_ERRORS.crm_invalid_test);
  if (['campaign.schedule','campaign.winner'].includes(input.action) && data.confirm_id !== data.id) fail(CRM_ERRORS.crm_confirm_required);
  return { action: input.action, data };
}
export const crmIsRead = action => CRM_READ_ACTIONS.includes(action);
