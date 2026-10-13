-- Organizaciones con la descarga masiva activada, para el trabajo periódico (corre sin contexto de organización).
create or replace function app.orgs_with_fiscal_sync(p_provider text)
returns table (organization_id uuid)
language sql security definer
set search_path = public
as $$
  select c.organization_id from fiscal_provider_connections c
  where c.provider = p_provider and c.external_account_id is not null and coalesce(c.settings->>'sync_enabled', 'false') = 'true'
$$;
grant execute on function app.orgs_with_fiscal_sync(text) to procura_app;
