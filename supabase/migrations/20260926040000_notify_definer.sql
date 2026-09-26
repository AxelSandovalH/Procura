-- notify() crea notificaciones para memberships que casi siempre son de la organización
-- CONTRAPARTE del actor (ej. avisar a Compras del comprador). notifications es INTERNAL
-- (organization_id = current_org()); bajo el contexto RLS del actor el INSERT viola la policy
-- y aborta la transacción completa. Igual patrón que emit_domain_event_row: el backend ya
-- decidió que estos destinatarios son legítimos antes de llamar esta función.
create or replace function app.create_notification_row(
  p_organization_id uuid, p_membership_id uuid, p_event_id uuid, p_type text,
  p_title text, p_body text, p_resource_type text, p_resource_id uuid
)
returns uuid
language sql security definer
set search_path = public
as $$
  insert into notifications (organization_id, membership_id, event_id, type, title, body, resource_type, resource_id)
  values (p_organization_id, p_membership_id, p_event_id, p_type, p_title, p_body, p_resource_type, p_resource_id)
  returning id
$$;

revoke all on function app.create_notification_row(uuid, uuid, uuid, text, text, text, text, uuid) from public;
grant execute on function app.create_notification_row(uuid, uuid, uuid, text, text, text, text, uuid) to procura_app;
