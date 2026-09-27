-- Correos de Procura (avisos de las notificaciones in-app), enviados por el cron con Resend.
-- notifications.emailed_at ya existía; se agregan reintentos/errores y la preferencia del usuario.

alter table users add column if not exists email_notifications boolean not null default true;
alter table notifications add column if not exists email_attempts int not null default 0;
alter table notifications add column if not exists email_error text;
create index if not exists notifications_email_pending_idx on notifications (created_at) where emailed_at is null;

-- Lo generado antes de esta función no se envía: evita inundar las bandejas con historial.
update notifications set emailed_at = now(), email_error = 'omitida: anterior a los correos' where emailed_at is null;

-- Reclama un lote para enviar (at-most-once por ciclo: marca emailed_at al reclamar; si el envío falla se libera con
-- email_outbox_result y se reintenta hasta 3 veces). Omite lo viejo, a quien desactivó los correos y los mensajes
-- repetidos (un mensaje por conversación cada 10 min: no se envía un correo por cada línea de chat).
create or replace function app.email_outbox_claim(p_limit int)
returns table (
  id uuid, email text, full_name text, org_name text, type text, title text, body text,
  resource_type text, resource_id uuid, anchor_type text, anchor_id uuid
)
language plpgsql security definer
set search_path = public
as $$
begin
  update notifications n set emailed_at = now(), email_error = 'omitida: antigua'
   where n.emailed_at is null and n.created_at < now() - interval '2 days';

  update notifications n set emailed_at = now(), email_error = 'omitida: el usuario desactivó los correos'
    from memberships m join users u on u.id = m.user_id
   where n.membership_id = m.id and n.emailed_at is null and not u.email_notifications;

  update notifications n set emailed_at = now(), email_error = 'omitida: mensaje agrupado'
   where n.emailed_at is null and n.type = 'message.posted' and exists (
     select 1 from notifications o
      where o.id <> n.id and o.membership_id = n.membership_id and o.type = n.type and o.resource_id is not distinct from n.resource_id
        and ((o.emailed_at is not null and o.email_error is null and o.emailed_at > now() - interval '10 minutes')
             or (o.emailed_at is null and o.created_at < n.created_at)));

  return query
  with c as (
    select nn.id from notifications nn
     where nn.emailed_at is null and nn.email_attempts < 3
     order by nn.created_at limit p_limit for update skip locked
  ), u as (
    update notifications n set emailed_at = now() from c where n.id = c.id returning n.*
  )
  select u.id, us.email::text, us.full_name, o.display_name, u.type, u.title, u.body, u.resource_type, u.resource_id,
         t.anchor_type::text, t.anchor_id
    from u
    join memberships m on m.id = u.membership_id
    join users us on us.id = m.user_id
    join organizations o on o.id = u.organization_id
    left join threads t on u.resource_type = 'thread' and t.id = u.resource_id;
end
$$;

create or replace function app.email_outbox_result(p_id uuid, p_ok boolean, p_error text)
returns void
language sql security definer
set search_path = public
as $$
  update notifications
     set emailed_at = case when p_ok then now() else null end,
         email_error = case when p_ok then null else left(coalesce(p_error, 'error'), 500) end,
         email_attempts = email_attempts + case when p_ok then 0 else 1 end
   where id = p_id
$$;

revoke all on function app.email_outbox_claim(int) from public;
revoke all on function app.email_outbox_result(uuid, boolean, text) from public;
grant execute on function app.email_outbox_claim(int) to procura_app;
grant execute on function app.email_outbox_result(uuid, boolean, text) to procura_app;
