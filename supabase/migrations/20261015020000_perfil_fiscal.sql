-- Datos fiscales de la organización para PEDIR facturas a sus proveedores (RFC y razón social ya viven en organizations).
create table if not exists organization_fiscal_profiles (
  organization_id   uuid primary key references organizations(id) on delete cascade,
  tax_regime_code   text,                       -- clave SAT del régimen fiscal (601, 612, 626…)
  zip_code          text,                       -- código postal del domicilio fiscal
  cfdi_use_code     text not null default 'G03', -- uso de CFDI por omisión para compras
  street            text,
  exterior_number   text,
  interior_number   text,
  neighborhood      text,                       -- colonia
  municipality      text,                       -- municipio o alcaldía
  state             text,
  invoice_email     text,                       -- correo al que los proveedores envían la factura
  updated_at        timestamptz not null default now()
);
alter table organization_fiscal_profiles enable row level security; alter table organization_fiscal_profiles force row level security;
drop policy if exists p_internal on organization_fiscal_profiles;
create policy p_internal on organization_fiscal_profiles for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
grant select, insert, update, delete on organization_fiscal_profiles to procura_app;
