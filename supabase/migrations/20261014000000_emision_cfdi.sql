-- Emisión de CFDI desde una venta (proveedor fiscal) — datos fiscales mínimos necesarios.
alter table customers add column if not exists tax_regime_code text;      -- clave SAT del régimen del receptor (601, 612, 616…)
alter table customers add column if not exists zip_code text;             -- código postal fiscal del receptor
alter table customers add column if not exists cfdi_use_code text;        -- uso de CFDI (G01, G03, S01…)

alter table sale_lines add column if not exists sat_product_code text;    -- clave de producto o servicio SAT (ClaveProdServ)
alter table sale_lines add column if not exists sat_unit_code text;       -- clave de unidad SAT (E48, H87…)

-- Configuración de la conexión (sin secretos): emisor en el proveedor, CP de expedición, serie y claves por omisión.
alter table fiscal_provider_connections add column if not exists settings jsonb not null default '{}';

-- Bloqueo contra doble timbrado: una venta solo puede tener una emisión en curso o completada.
create table if not exists fiscal_issue_requests (
  id                  uuid primary key default app.uuid_v7(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  sale_id             uuid not null references sales(id) on delete cascade,
  provider            text not null,
  status              text not null check (status in ('PENDING', 'DONE', 'FAILED')),
  provider_invoice_id text,
  cfdi_id             uuid references cfdi_documents(id),
  error               text,
  created_by_membership_id uuid references memberships(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists fiscal_issue_one_live_uq on fiscal_issue_requests (sale_id) where status in ('PENDING', 'DONE');
alter table fiscal_issue_requests enable row level security; alter table fiscal_issue_requests force row level security;
drop policy if exists p_internal on fiscal_issue_requests;
create policy p_internal on fiscal_issue_requests for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
grant select, insert, update, delete on fiscal_issue_requests to procura_app;
