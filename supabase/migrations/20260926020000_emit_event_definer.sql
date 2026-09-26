-- emitEvent() escribe un domain_event por organización RECEPTORA, que en un evento shared casi
-- siempre incluye a la contraparte (no la organización activa del actor). domain_events es
-- INTERNAL (RLS = organization_id = current_org()), así que un INSERT para la contraparte viola
-- RLS y aborta TODA la transacción que lo llama — no solo la notificación, la acción de negocio
-- completa (rfq.issue, order.confirm, etc.). Esta función inserta UNA fila, validada por el
-- backend antes de llamarla (ya decidió que ese destinatario es legítimo); callable solo por
-- procura_app, mismo modelo de confianza que las funciones del dispatcher.
create or replace function app.emit_domain_event_row(
  p_event_key uuid, p_type text, p_aggregate_type text, p_aggregate_id uuid,
  p_organization_id uuid, p_perspective event_perspective, p_actor jsonb, p_payload jsonb
)
returns uuid
language sql security definer
set search_path = public
as $$
  insert into domain_events (event_key, type, aggregate_type, aggregate_id, organization_id, perspective, actor, payload)
  values (p_event_key, p_type, p_aggregate_type, p_aggregate_id, p_organization_id, p_perspective, p_actor, p_payload)
  returning id
$$;

revoke all on function app.emit_domain_event_row(uuid, text, text, uuid, uuid, event_perspective, jsonb, jsonb) from public;
grant execute on function app.emit_domain_event_row(uuid, text, text, uuid, uuid, event_perspective, jsonb, jsonb) to procura_app;
