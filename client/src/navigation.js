import { OP_TABS } from './operations/model.js';

const groups = {
  jornada: 'Trabajo diario', turnos: 'Trabajo diario',
  torneos: 'Competición', arbitraje: 'Competición', incidencias: 'Competición', estadisticas: 'Competición', disciplina: 'Competición', clubes: 'Competición',
  casters: 'Emisión y comunidad', realizacion: 'Emisión y comunidad', discord: 'Emisión y comunidad', contenido: 'Emisión y comunidad',
  historico: 'Seguimiento', decisiones: 'Seguimiento',
};
const titles = { torneos: 'Torneos', incidencias: 'Arbitraje', turnos: 'Turnos de staff', casters: 'Dossiers de partidos', realizacion: 'Preparar directo', decisiones: 'Decisiones pendientes' };
const aliases = { jornada: 'inicio tareas agenda', incidencias: 'árbitro disputa reto expediente soporte', estadisticas: 'ocr captura revisión bajas muertes', clubes: 'verificar identidad logo escudo', casters: 'narración roster mapas', realizacion: 'emisión streaming obs', decisiones: 'enviar propuestas pendientes' };
const editorial = [
  { section: 'calendario', to: '/calendario', title: 'Calendario editorial', keywords: 'publicaciones redes' },
  { section: 'escaleta', to: '/escaleta', title: 'Escaleta', keywords: 'guion emisión' },
  { section: 'recursos', to: '/recursos', title: 'Recursos', keywords: 'archivos pendientes' },
  { section: 'tablero', to: '/tablero', title: 'Tablero', keywords: 'contenido tareas' },
];
export function managerNavigation(can, isAdmin) {
  const items = OP_TABS.filter(tab => tab.sections.some(can)).map(tab => ({
    id: tab.id, to: `/operaciones/${tab.id}`, title: titles[tab.id] || tab.title, group: groups[tab.id],
    keywords: `${tab.title} ${tab.id} ${aliases[tab.id] || ''}`,
  }));
  if (can('disponibilidad')) items.splice(Math.min(2, items.length), 0, { id: 'disponibilidad', to: '/disponibilidad', title: 'Mi disponibilidad', group: 'Trabajo diario', keywords: 'agenda días horarios' });
  items.push(...editorial.filter(item => can(item.section)).map(item => ({ ...item, id: item.section, group: 'Contenido editorial' })));
  if (isAdmin) items.push(
    { id: 'administracion', to: '/administracion/resumen', title: 'Administración CTP', group: 'Administración', keywords: 'jugadores clubes accesos pases mapas campañas ranked integraciones auditoría' },
    { id: 'usuarios', to: '/usuarios', title: 'Usuarios y roles', group: 'Administración', keywords: 'permisos staff cuentas' },
    { id: 'integracion', to: '/operaciones/integracion', title: 'Conexión CTP', group: 'Administración', keywords: 'api sincronización integración' },
  );
  return items;
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
