-- Portal público de autofacturación: el cliente final pide su CFDI con el folio y el total de su ticket.
create table if not exists autoinvoice_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  enabled         boolean not null default false,
  window_days     int not null default 30 check (window_days between 1 and 365),   -- días después de la venta en que aún se puede facturar
  daily_limit     int not null default 50 check (daily_limit between 1 and 5000),  -- tope de facturas pedidas por el público en 24 horas (protege tus timbres)
  default_payment_form text not null default '01' check (default_payment_form ~ '^\d{2}$'),  -- si la venta no trae método de pago
  welcome_text    text check (welcome_text is null or length(welcome_text) <= 500),
  updated_at      timestamptz not null default now()
);
alter table autoinvoice_settings enable row level security; alter table autoinvoice_settings force row level security;
drop policy if exists p_internal on autoinvoice_settings;
create policy p_internal on autoinvoice_settings for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
grant select, insert, update, delete on autoinvoice_settings to procura_app;

-- De dónde vino cada emisión y quién la pidió (el público no tiene sesión).
alter table fiscal_issue_requests
  add column if not exists source text not null default 'USER' check (source in ('USER', 'PORTAL')),
  add column if not exists requester_email text,
  add column if not exists requester_ip_hash text;
create index if not exists fiscal_issue_portal_idx on fiscal_issue_requests (organization_id, created_at) where source = 'PORTAL';

-- Búsqueda pública por slug (sin sesión): solo organizaciones activas con el portal encendido, y solo lo mínimo que la página necesita.
create or replace function app.autoinvoice_public_info(p_slug text)
returns table (organization_id uuid, slug text, display_name text, welcome_text text, window_days int, daily_limit int, default_payment_form text)
language sql security definer stable
set search_path = public
as $$
  select o.id, o.slug, o.display_name, a.welcome_text, a.window_days, a.daily_limit, a.default_payment_form
  from organizations o join autoinvoice_settings a on a.organization_id = o.id
  where o.slug = lower(p_slug) and o.status = 'ACTIVE' and a.enabled
$$;
revoke all on function app.autoinvoice_public_info(text) from public;
grant execute on function app.autoinvoice_public_info(text) to procura_app;
