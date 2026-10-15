const commands={
  'club.create':'Alta manual de club',
  'ranked.season.schedule':'Programación de SEASON Ranked',
  'ranked.season.update':'Corrección del calendario Ranked',
  'ranked.season.cancel':'Cancelación del calendario Ranked',
  'guard.configure':'Requisitos Guard del torneo',
  'guard.exempt':'Verificación de consola',
  'guard.start':'Autorización de inicio',
  'incident.resolve':'Resolución de incidencia',
  'incident.reply':'Respuesta al expediente',
  'stats.review':'Revisión de estadísticas',
  'stats.correct':'Corrección de estadísticas',
  'club.verify':'Verificación de club',
  'discord.retry':'Reintento de aviso de Discord',
  'sanction.create':'Aplicación de sanción',
  'sanction.appeal':'Recurso de sanción',
  'sanction.review':'Revisión de recurso',
  'sanction.revoke':'Revocación de sanción',
  'tournament.create':'Alta de torneo',
  'tournament.update':'Edición de torneo',
  'tournament.status':'Cambio de estado del torneo',
  'tournament.registration':'Revisión de inscripción',
  'tournament.generate':'Generación de fase',
  'tournament.publish':'Publicación de fase',
  'tournament.schedule':'Reprogramación de partido',
};
const local={
  'incident.created':'Expediente abierto',
  'incident.updated':'Seguimiento del expediente actualizado',
  'incident.note.created':'Nota añadida al expediente',
  'incident.closed_internal':'Expediente interno cerrado',
  'assignment.created':'Turno asignado',
  'assignment.confirmed':'Turno confirmado',
  'assignment.declined':'Turno rechazado por la persona asignada',
  'assignment.cancelled':'Turno cancelado por coordinación',
  'assignment.rescheduled':'Horario del turno actualizado',
  'assignment.replaced':'Persona asignada al turno sustituida',
  'caster.note.created':'Nota de narración añadida',
  'production.updated':'Preparación del encuentro actualizada',
  'stats.correction.prepared':'Nueva revisión de estadísticas preparada',
  'sanction.drafted':'Propuesta disciplinaria creada',
  'sanction.appealed':'Recurso registrado',
  'sanction.reviewed':'Recurso revisado',
  'content.created':'Tarjeta editorial preparada',
};
const stages={requested:'propuesta preparada',acknowledged:'confirmación recibida de CTP',cancelled:'propuesta descartada',rejected:'rechazo recibido de CTP'};
export function actionLabel(action) {
  if(typeof action!=='string')return 'Acción de staff';
  const code=action.replace(/^manager\./,'');
  if(local[code])return local[code];
  if(commands[code])return commands[code];
  const separator=code.lastIndexOf('.');
  const name=commands[code.slice(0,separator)],stage=stages[code.slice(separator+1)];
  return name&&stage?`${name}: ${stage}`:'Acción de staff';
}
