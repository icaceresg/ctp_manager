/** A delayed detail must never become the selected case or expose its context. */
export function selectedCaseContext(detail, incidents, selected) {
  const item = detail?.incident || detail?.resource;
  const current = item?.id === selected ? detail : null;
  const incident = current ? item : incidents.find(row => row.id === selected);
  return { incident, notes: current?.notes || incident?.notes || [], audit: current?.audit || [] };
}
