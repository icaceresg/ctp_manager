import { OP_TABS } from './operations/model.js';
import { metricsAllowedHost } from './pages/metricsModel.js';

const groups = {
  jornada: 'Trabajo diario', turnos: 'Trabajo diario', decisiones: 'Trabajo diario',
  torneos: 'Competición', incidencias: 'Competición', arbitraje: 'Competición', estadisticas: 'Competición', sanciones: 'Competición', clubes: 'Competición', historico: 'Competición',
  casters: 'Emisión y comunidad', realizacion: 'Emisión y comunidad', discord: 'Emisión y comunidad', contenido: 'Emisión y comunidad',
};
const titles = { torneos: 'Torneos', incidencias: 'Incidencias', turnos: 'Turnos de staff', casters: 'Dossiers de partidos', realizacion: 'Preparar directo', decisiones: 'Decisiones pendientes' };
const aliases = { jornada: 'inicio tareas agenda', incidencias: 'arbitraje árbitro disputa reto expediente soporte ticket', arbitraje: 'partidos actas resultado veto pick ban', sanciones: 'disciplina amonestación amonestar suspensión ban bloqueo castigo jugadores cuentas historial recurso', historico: 'búsqueda partidos pasados', estadisticas: 'ocr captura revisión bajas muertes', clubes: 'verificar identidad logo escudo', casters: 'narración roster mapas', realizacion: 'emisión streaming obs', decisiones: 'enviar propuestas pendientes' };
const editorial = [
  { section: 'calendario', to: '/calendario', title: 'Calendario editorial', keywords: 'publicaciones redes' },
  { section: 'escaleta', to: '/escaleta', title: 'Escaleta', keywords: 'guion emisión' },
  { section: 'recursos', to: '/recursos', title: 'Recursos', keywords: 'archivos pendientes' },
  { section: 'tablero', to: '/tablero', title: 'Tablero', keywords: 'contenido tareas' },
];
export function managerNavigation(can, isAdmin, staffManager = false, rankedStaff = false, hostname = '') {
  const items = OP_TABS.filter(tab => tab.sections.some(can)).map(tab => ({
    id: tab.id, to: `/operaciones/${tab.id}`, title: titles[tab.id] || tab.title, group: groups[tab.id],
    keywords: `${tab.title} ${tab.id} ${aliases[tab.id] || ''}`,
  }));
  if (can('disponibilidad')) items.splice(items.findIndex(item => item.id === 'jornada') + 1, 0, { id: 'disponibilidad', to: '/disponibilidad', title: 'Mi disponibilidad', group: 'Trabajo diario', keywords: 'agenda días horarios' });
  items.push(...editorial.filter(item => can(item.section)).map(item => ({ ...item, id: item.section, group: 'Contenido editorial' })));
  if (isAdmin || rankedStaff) items.push({ id: 'ranked-monitor', to: '/ranked/monitor', title: 'Monitor de Ranked · 8s', group: 'Competición', keywords: 'ranked 8s colas simultáneas jugadores grupos esperas partidas mapas métricas monitorización' });
  if (isAdmin) items.push(
    { id: 'administracion', to: '/administracion/resumen', title: 'Administración CTP', group: 'Administración', keywords: 'jugadores clubes accesos pases mapas campañas ranked integraciones auditoría' },
    { id: 'crm', to: '/crm/resumen', title: 'CRM y correos', group: 'Administración', keywords: 'campañas email newsletter contactos segmentos marketing promocionales transaccionales plantillas fluentcrm' },
    { id: 'usuarios', to: '/usuarios', title: 'Usuarios y roles', group: 'Administración', keywords: 'permisos staff cuentas' },
    { id: 'integracion', to: '/operaciones/integracion', title: 'Conexión CTP', group: 'Administración', keywords: 'api sincronización integración' },
  );
  if (isAdmin && metricsAllowedHost(hostname)) items.push({ id: 'metrics', to: '/administration/metrics', title: 'Tráfico y servidor', group: 'Administración', keywords: 'monitor métricas cpu memoria disco swap tráfico peticiones actividad ranked pre prod servidor' });
  if (!isAdmin && staffManager) items.push({ id: 'usuarios', to: '/usuarios', title: 'Usuarios y funciones', group: 'Coordinación', keywords: 'permisos staff cuentas funciones' });
  return items;
}
/** La ruleta es otra página (otro host en la VPS), así que va con enlace normal. */
export function ruletaNavigation(hostname) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  return { id: 'ruleta', href: local ? '/ruleta' : 'https://ruleta.playctp.com', title: 'Ruleta del directo', group: 'Emisión y comunidad', keywords: 'sorteo ganador caja destino premio' };
}
export function navigationSearch(items, query) {
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return items.filter(item => terms.every(term => normalize(`${item.title} ${item.group} ${item.keywords || ''}`).includes(term)));
}
export function matchReturnPath(value) {
  // Navigation state is untrusted: allow only known Manager list routes.
  if (typeof value !== 'string' || value.includes('\\')) return '/operaciones/jornada';
  const path = value.split(/[?#]/)[0];
  return OP_TABS.some(tab => path === `/operaciones/${tab.id}`) ? value : '/operaciones/jornada';
}
