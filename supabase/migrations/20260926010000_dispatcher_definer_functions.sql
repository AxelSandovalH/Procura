-- El despachador de webhooks es, por naturaleza, cross-org (procesa el outbox de TODAS las
-- organizaciones en cada ciclo). procura_app opera bajo RLS de una sola organización a la vez,
-- así que estas funciones SECURITY DEFINER acotan exactamente lo que el cron puede hacer:
-- reclamar el lote pendiente, y registrar el resultado de cada intento. La llamada HTTP real
-- sigue viviendo en Node (Postgres no puede hacer fetch); estas funciones solo mueven filas.

-- 1) Reclama eventos sin dispatched_at, crea las webhook_deliveries que falten para cada
--    endpoint activo cuyo event_types matchee, y marca los eventos como despachados.
--    Devuelve las deliveries recién creadas (intento 1) con lo necesario para el POST.
create or replace function app.dispatcher_claim_batch(p_limit integer default 200)
returns table (
  delivery_id uuid, endpoint_id uuid, url text, secret text,
  event_id uuid, event_type text, schema_version integer, occurred_at timestamptz,
  aggregate_type text, aggregate_id uuid, organization_id uuid, perspective event_perspective,
  actor jsonb, payload jsonb
)
language plpgsql security definer
set search_path = public
as $$
declare v_event record; v_endpoint record; v_delivery_id uuid;
begin
  for v_event in
    select * from domain_events de where de.dispatched_at is null order by de.id asc limit p_limit
  loop
    for v_endpoint in
      select * from webhook_endpoints we
      where we.organization_id = v_event.organization_id and we.is_active
        and (we.event_types && array['*', v_event.type])
    loop
      if not exists (select 1 from webhook_deliveries wd where wd.endpoint_id = v_endpoint.id and wd.event_id = v_event.id) then
        -- next_retry_at = now(): si Node falla entre crear esta fila y registrar el resultado,
        -- el próximo ciclo la recoge por app.dispatcher_claim_due_retries en vez de perderla.
        insert into webhook_deliveries (endpoint_id, organization_id, event_id, attempt, status, next_retry_at)
        values (v_endpoint.id, v_event.organization_id, v_event.id, 1, 'PENDING', now())
        returning id into v_delivery_id;

        delivery_id := v_delivery_id; endpoint_id := v_endpoint.id; url := v_endpoint.url; secret := v_endpoint.secret_hash;
        event_id := v_event.id; event_type := v_event.type; schema_version := v_event.schema_version; occurred_at := v_event.occurred_at;
        aggregate_type := v_event.aggregate_type; aggregate_id := v_event.aggregate_id; organization_id := v_event.organization_id;
        perspective := v_event.perspective; actor := v_event.actor; payload := v_event.payload;
        return next;
      end if;
    end loop;
    update domain_events de set dispatched_at = now() where de.id = v_event.id;
  end loop;
end $$;

-- 2) Reclama reintentos vencidos (status PENDING, next_retry_at <= now()) con el mismo shape.
create or replace function app.dispatcher_claim_due_retries(p_limit integer default 200)
returns table (
  delivery_id uuid, endpoint_id uuid, url text, secret text, attempt integer,
  event_id uuid, event_type text, schema_version integer, occurred_at timestamptz,
  aggregate_type text, aggregate_id uuid, organization_id uuid, perspective event_perspective,
  actor jsonb, payload jsonb
)
language sql security definer stable
set search_path = public
as $$
  select wd.id, wd.endpoint_id, we.url, we.secret_hash, wd.attempt,
         de.id, de.type, de.schema_version, de.occurred_at, de.aggregate_type, de.aggregate_id, de.organization_id, de.perspective, de.actor, de.payload
  from webhook_deliveries wd
  join webhook_endpoints we on we.id = wd.endpoint_id
  join domain_events de on de.id = wd.event_id
  where wd.status = 'PENDING' and wd.next_retry_at is not null and wd.next_retry_at <= now()
  order by wd.next_retry_at asc
  limit p_limit
$$;

-- 3) Registra el resultado de un intento (éxito, reintento programado, o agotado) y actualiza
--    el contador de fallos consecutivos del endpoint, desactivándolo tras demasiados.
create or replace function app.dispatcher_record_result(
  p_delivery_id uuid, p_endpoint_id uuid, p_success boolean, p_response_status integer,
  p_response_body text, p_error text, p_next_attempt integer, p_next_retry_at timestamptz, p_exhausted boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_failures integer;
begin
  if p_success then
    update webhook_deliveries set status = 'SUCCEEDED'::webhook_delivery_status, response_status = p_response_status, response_body = p_response_body, delivered_at = now() where id = p_delivery_id;
    update webhook_endpoints set consecutive_failures = 0 where id = p_endpoint_id;
  else
    update webhook_deliveries set
      status = case when p_exhausted then 'EXHAUSTED'::webhook_delivery_status else 'PENDING'::webhook_delivery_status end,
      attempt = p_next_attempt, response_status = p_response_status, response_body = p_response_body, error = p_error,
      next_retry_at = case when p_exhausted then null else p_next_retry_at end
    where id = p_delivery_id;

    update webhook_endpoints set consecutive_failures = consecutive_failures + 1 where id = p_endpoint_id
    returning consecutive_failures into v_failures;
    if v_failures >= 50 then
      update webhook_endpoints set is_active = false, disabled_reason = v_failures || ' fallos consecutivos' where id = p_endpoint_id;
    end if;
  end if;
end $$;

revoke all on function app.dispatcher_claim_batch(integer) from public;
revoke all on function app.dispatcher_claim_due_retries(integer) from public;
revoke all on function app.dispatcher_record_result(uuid, uuid, boolean, integer, text, text, integer, timestamptz, boolean) from public;
grant execute on function app.dispatcher_claim_batch(integer) to procura_app;
grant execute on function app.dispatcher_claim_due_retries(integer) to procura_app;
grant execute on function app.dispatcher_record_result(uuid, uuid, boolean, integer, text, text, integer, timestamptz, boolean) to procura_app;
