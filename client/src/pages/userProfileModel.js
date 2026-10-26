export const PROFILE_FIELDS = Object.freeze(['username','email','gamertag','activision_id','platform','discord','twitter','bio','birthdate']);
/** Preserve the supplied identity exactly apart from surrounding whitespace. */
export function profileChanges(profile, values) {
  const changes = {};
  for (const field of PROFILE_FIELDS) {
    const value = typeof values[field] === 'string' ? values[field].trim() : '';
    if (value !== (profile[field] ?? '')) changes[field] = value;
  }
  return changes;
}
