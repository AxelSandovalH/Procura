-- Facturas recibidas (CFDI del proveedor ligado a una orden) y gastos de la organización compradora.
--  * supplier_invoices: SHARED (comprador y proveedor la ven). El XML/PDF viven en Storage (bucket de adjuntos).
--  * expenses / expense_invoices: INTERNAL de la organización. Si la organización usa un ERP (expenses_managed_by='ERP'),
--    los gastos los lleva el ERP y Procura solo entrega la orden recibida y la factura ligada.

do $$ begin
  create type supplier_invoice_status as enum ('VALIDATED', 'DISCREPANCY', 'ACCEPTED', 'REJECTED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type expense_source as enum ('MANUAL', 'PROCURA', 'ERP');
exception when duplicate_object then null; end $$;

alter type attachment_anchor_type add value if not exists 'EXPENSE';

alter table organization_settings add column if not exists expenses_managed_by text not null default 'PROCURA' check (expenses_managed_by in ('PROCURA', 'ERP'));

create table if not exists supplier_invoices (
  id                          uuid primary key default app.uuid_v7(),
  order_id                    uuid not null references orders(id),
  buyer_organization_id       uuid not null references organizations(id),
  supplier_organization_id    uuid not null references organizations(id),
  fiscal_uuid                 text not null,                                   -- UUID del timbre fiscal (SAT)
  series                      text,
  folio                       text,
  cfdi_version                text,
  issued_at                   timestamptz,
  issuer_rfc                  text not null,
  issuer_name                 text,
  receiver_rfc                text not null,
  receiver_name               text,
  currency                    char(3) not null,
  exchange_rate               numeric(18,6),
  subtotal_minor              bigint not null,
  tax_minor                   bigint not null default 0,
  total_minor                 bigint not null,
  status                      supplier_invoice_status not null,
  discrepancies               jsonb not null default '[]',
  xml_storage_key             text not null,
  xml_filename                text not null,
  pdf_storage_key             text,
  pdf_filename                text,
  uploaded_by_membership_id   uuid references memberships(id),
  reviewed_by_membership_id   uuid references memberships(id),
  reviewed_at                 timestamptz,
  review_reason               text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (status <> 'REJECTED' or review_reason is not null)
);
-- Un mismo CFDI no se registra dos veces (una rechazada libera el UUID para volver a subirla corregida).
create unique index if not exists supplier_invoices_uuid_uq on supplier_invoices (supplier_organization_id, upper(fiscal_uuid)) where status <> 'REJECTED';
create index if not exists supplier_invoices_order_idx on supplier_invoices (order_id, created_at desc);
create index if not exists supplier_invoices_buyer_idx on supplier_invoices (buyer_organization_id, created_at desc);

create table if not exists expenses (
  id                          uuid primary key default app.uuid_v7(),
  organization_id             uuid not null references organizations(id),
  spent_at                    date not null,
  description                 text not null,
  category                    text,
  amount_minor                bigint not null check (amount_minor >= 0),
  currency                    char(3) not null,
  supplier_organization_id    uuid references organizations(id),
  supplier_name               text,
  order_id                    uuid references orders(id),
  source                      expense_source not null default 'MANUAL',
  external_reference          text,
  created_by_membership_id    uuid references memberships(id),
  voided_at                   timestamptz,
  void_reason                 text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (voided_at is null or void_reason is not null)
);
create index if not exists expenses_org_idx on expenses (organization_id, spent_at desc);
create index if not exists expenses_order_idx on expenses (order_id) where order_id is not null;
create unique index if not exists expenses_external_uq on expenses (organization_id, external_reference) where external_reference is not null;

create table if not exists expense_invoices (
  expense_id          uuid not null references expenses(id) on delete cascade,
  supplier_invoice_id uuid not null references supplier_invoices(id),
  organization_id     uuid not null references organizations(id),
  created_at          timestamptz not null default now(),
  primary key (expense_id, supplier_invoice_id)
);

-- RLS (mismo patrón que el resto): compartida para facturas; interna para gastos.
alter table supplier_invoices enable row level security; alter table supplier_invoices force row level security;
alter table expenses enable row level security;          alter table expenses force row level security;
alter table expense_invoices enable row level security;  alter table expense_invoices force row level security;
drop policy if exists p_shared on supplier_invoices;
create policy p_shared on supplier_invoices for all to procura_app
  using (app.current_org() in (buyer_organization_id, supplier_organization_id))
  with check (app.current_org() in (buyer_organization_id, supplier_organization_id));
drop policy if exists p_internal on expenses;
create policy p_internal on expenses for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
drop policy if exists p_internal on expense_invoices;
create policy p_internal on expense_invoices for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
grant select, insert, update, delete on supplier_invoices, expenses, expense_invoices to procura_app;

-- Permisos nuevos
insert into permissions (code, module, side, description) values
  ('invoice.submit', 'billing', 'SUPPLIER', 'Adjuntar facturas (CFDI) a una orden'),
  ('invoice.read',   'billing', 'ANY',      'Ver facturas de una orden'),
  ('invoice.review', 'billing', 'BUYER',    'Aceptar con diferencia o rechazar facturas recibidas'),
  ('expense.read',   'billing', 'BUYER',    'Ver gastos'),
  ('expense.manage', 'billing', 'BUYER',    'Registrar gastos y ligarlos a facturas')
on conflict (code) do nothing;

-- Plantillas (organizaciones nuevas)
insert into role_templates (name, description, permission_code)
select 'Administrador', 'Acceso total a la organización', code from permissions where code in ('invoice.submit','invoice.read','invoice.review','expense.read','expense.manage')
union all select 'Compras', 'Gestiona proveedores, cotizaciones y órdenes', unnest(array['invoice.read','invoice.review','expense.read','expense.manage'])
union all select 'Finanzas', 'Visibilidad financiera y configuración de aprobaciones', unnest(array['invoice.read','invoice.review','expense.read','expense.manage'])
union all select 'Proveedor', 'Atiende RFQ, cotiza, confirma órdenes y registra entregas', unnest(array['invoice.submit','invoice.read'])
on conflict do nothing;

-- Organizaciones existentes: sus roles base reciben los permisos nuevos (los roles personalizados no se tocan).
insert into role_permissions (role_id, permission_code, organization_id)
select r.id, t.permission_code, r.organization_id
from roles r join role_templates t on t.name = r.name
where r.is_system and t.permission_code in ('invoice.submit','invoice.read','invoice.review','expense.read','expense.manage')
on conflict do nothing;
