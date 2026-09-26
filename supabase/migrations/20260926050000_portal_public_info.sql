-- El portal de una organización es público (nombre, texto de bienvenida), pero organization_settings
-- es INTERNAL (RLS por organización) y GET /portal/{slug} corre sin sesión ni contexto de org.
-- Función SECURITY DEFINER acotada: solo expone campos públicos y SOLO de organizaciones ACTIVE con
-- el portal habilitado. Si el portal está apagado devuelve 0 filas (el caller responde 404), de modo
-- que no se puede enumerar qué organizaciones existen sin portal.
create or replace function app.portal_public_info(p_slug text)
returns table (organization_id uuid, slug text, display_name text, welcome_text text)
language sql security definer stable
set search_path = public
as $$
  select o.id, o.slug, o.display_name, s.portal_welcome_text
  from organizations o
  join organization_settings s on s.organization_id = o.id
  where o.slug = lower(p_slug) and o.status = 'ACTIVE' and s.portal_enabled
$$;

revoke all on function app.portal_public_info(text) from public;
grant execute on function app.portal_public_info(text) to procura_app;
