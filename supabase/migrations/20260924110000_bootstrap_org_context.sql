-- El bootstrap de una organización corre dentro de la transacción que la crea, antes de que
-- exista contexto RLS para ella. El trigger fija app.organization_id = nueva org (solo en esta
-- transacción) para que sus inserts en settings/roles/memberships pasen las policies INTERNAL.
create or replace function app.bootstrap_organization() returns trigger
language plpgsql as $$
declare r record; v_role_id uuid; v_membership_id uuid;
begin
  perform set_config('app.organization_id', new.id::text, true);

  insert into organization_settings (organization_id) values (new.id);

  for r in select distinct name, description from role_templates loop
    insert into roles (organization_id, name, description, is_system)
    values (new.id, r.name, r.description, true)
    returning id into v_role_id;

    insert into role_permissions (role_id, permission_code, organization_id)
    select v_role_id, permission_code, new.id from role_templates where name = r.name;
  end loop;

  if new.created_by_user_id is not null then
    insert into memberships (user_id, organization_id, status, requested_by, is_primary_admin, activated_at)
    values (new.created_by_user_id, new.id, 'ACTIVE', 'ORGANIZATION', true, now())
    returning id into v_membership_id;

    insert into role_assignments (organization_id, membership_id, role_id, scope_type)
    select new.id, v_membership_id, id, 'ORGANIZATION' from roles where organization_id = new.id and name = 'Administrador';
  end if;
  return new;
end $$;
