/**
 * Private by default: la contraparte ve QUÉ organización escribió, no el id interno de la persona
 * (memberships es interno de cada organización). El autor propio sí conserva su membership id.
 */
export function publicMessage<T extends { author_organization_id: string; author_membership_id: string }>(m: T, actorOrganizationId: string) {
  if (m.author_organization_id === actorOrganizationId) return m;
  const { author_membership_id, ...rest } = m;
  void author_membership_id;
  return rest;
}
