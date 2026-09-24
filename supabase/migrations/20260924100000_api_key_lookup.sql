-- Búsqueda de API key por hash sin contexto de organización (la RLS de api_keys lo impide).
-- SECURITY DEFINER acotado: solo devuelve id + organization_id de keys vivas.
create or replace function app.lookup_api_key(p_hash text)
returns table (id uuid, organization_id uuid)
language sql security definer stable
set search_path = public
as $$
  select id, organization_id
  from api_keys
  where key_hash = p_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  limit 1
$$;

revoke all on function app.lookup_api_key(text) from public;
grant execute on function app.lookup_api_key(text) to procura_app;
