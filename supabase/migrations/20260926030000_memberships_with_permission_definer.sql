-- notifyPermissionHolders() necesita resolver "quién en la OTRA organización tiene este permiso"
-- (ej. avisar a Compras del comprador cuando el proveedor cotiza). role_assignments es INTERNAL
-- (RLS de una sola org) y el contexto de la transacción es el del actor, no el de la contraparte.
-- Sin esto, la consulta devuelve 0 filas SILENCIOSAMENTE (RLS en un SELECT no lanza error) y la
-- notificación simplemente nunca se crea — bug detectado probando, no visible como excepción.
create or replace function app.memberships_with_permission(p_org uuid, p_permission text, p_exclude_membership uuid default null)
returns table (membership_id uuid)
language sql security definer stable
set search_path = public
as $$
  select distinct ra.membership_id
  from role_assignments ra
  join roles r on r.id = ra.role_id
  join role_permissions rp on rp.role_id = r.id and rp.permission_code = p_permission
  join memberships m on m.id = ra.membership_id
  where ra.organization_id = p_org and ra.revoked_at is null and m.status = 'ACTIVE'
    and (p_exclude_membership is null or ra.membership_id <> p_exclude_membership)
$$;

revoke all on function app.memberships_with_permission(uuid, text, uuid) from public;
grant execute on function app.memberships_with_permission(uuid, text, uuid) to procura_app;
