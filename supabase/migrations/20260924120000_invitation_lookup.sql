-- Las invitaciones son INTERNAL (RLS exige organization_id = app.current_org()), pero el flujo
-- de previsualizar/aceptar por token ocurre ANTES de saber a qué organización pertenecen.
-- Estas funciones SECURITY DEFINER exponen solo lo necesario, sin saltarse las reglas de negocio.

create or replace function app.lookup_invitation_by_hash(p_hash text)
returns table (
  id uuid, organization_id uuid, kind invitation_kind, email citext,
  relationship_position relationship_position, auto_accept boolean,
  status invitation_status, expires_at timestamptz, max_uses integer, used_count integer,
  org_slug text, org_display_name text, role_names text[]
)
language sql security definer stable
set search_path = public
as $$
  select i.id, i.organization_id, i.kind, i.email, i.relationship_position, i.auto_accept,
         i.status, i.expires_at, i.max_uses, i.used_count,
         o.slug, o.display_name,
         coalesce(array_agg(r.name) filter (where r.name is not null), '{}')
  from invitations i
  join organizations o on o.id = i.organization_id
  left join invitation_roles ir on ir.invitation_id = i.id
  left join roles r on r.id = ir.role_id
  where i.token_hash = p_hash
  group by i.id, o.slug, o.display_name
$$;

-- Incremento atómico y seguro ante condiciones de carrera (max_uses > 1): solo cuenta si la
-- invitación sigue viva en el mismo instante en que se consume. Se puede llamar desde cualquier
-- contexto de organización porque valida todo internamente.
create or replace function app.consume_invitation(p_invitation_id uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_used integer;
begin
  update invitations
  set used_count = used_count + 1
  where id = p_invitation_id and status = 'ACTIVE' and used_count < max_uses and expires_at > now()
  returning used_count into v_used;

  if v_used is null then
    raise exception 'invitation_not_consumable' using errcode = 'P0001';
  end if;
  return v_used;
end $$;

revoke all on function app.lookup_invitation_by_hash(text) from public;
revoke all on function app.consume_invitation(uuid) from public;
grant execute on function app.lookup_invitation_by_hash(text) to procura_app;
grant execute on function app.consume_invitation(uuid) to procura_app;
