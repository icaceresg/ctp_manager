/** Capability comes only from the validated CTP snapshot, never a build/env flag. */
export function teamArchiveSupported(team) {
  return !!team && typeof team === 'object' && !Array.isArray(team) && Object.hasOwn(team, 'deleted_at')
    && (team.deleted_at === null || archiveDate(team.deleted_at));
}
function archiveDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && value.length <= 40 && Number.isFinite(Date.parse(value));
}
export const teamIsArchived = team => teamArchiveSupported(team) && team.deleted_at !== null;
export const activeAdministrationClubs = rows => rows.filter(row => !teamIsArchived(row));
export function teamCloseCopy(team) {
  return teamArchiveSupported(team)
    ? { title: 'manager.teamRoster.archiveTitle', help: 'manager.teamRoster.archiveHelp', action: 'manager.teamRoster.archive', toast: 'manager.teamRoster.toast.archived' }
    : { title: 'manager.teamRoster.dissolveTitle', help: 'manager.teamRoster.dissolveHelp', action: 'manager.teamRoster.dissolve', toast: 'manager.teamRoster.toast.dissolved' };
}
