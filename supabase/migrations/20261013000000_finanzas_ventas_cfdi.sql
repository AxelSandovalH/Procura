-- Módulo financiero: ventas, cobros y pagos, comprobantes fiscales (CFDI) emitidos y recibidos, y su vinculación con operaciones.
-- Decisiones (ver docs/FINANZAS.md):
--  * cfdi_documents es la ÚNICA fuente de verdad del dato fiscal (por organización: cada una guarda su copia).
--    supplier_invoices (factura del proveedor en una orden) conserva el flujo de revisión y apunta a sus cfdi_documents.
--  * cfdi_links liga un CFDI con una venta O un gasto, con el importe que documenta (un CFDI puede amparar varias operaciones
--    y una operación puede requerir varios CFDI). Sustituye a expense_invoices (se migra y queda sin uso).
--  * payments registra cobros (IN, venta) y pagos (OUT, gasto) parciales. Los estados de cobro/pago/facturación se DERIVAN de importes;
--    las columnas collected_minor / paid_minor / documented_minor son caché mantenida en la misma transacción.
--  * Sin catálogo contable ni pólizas todavía: todas las tablas llevan organización, fecha, referencia y trazabilidad para añadirlas después.

do $$ begin create type cfdi_direction as enum ('ISSUED', 'RECEIVED'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_direction as enum ('IN', 'OUT'); exception when duplicate_object then null; end $$;

create table if not exists customers (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  tax_id          text,
  email           text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists customers_org_idx on customers (organization_id, lower(name));

create table if not exists sales (
  id                       uuid primary key default app.uuid_v7(),
  organization_id          uuid not null references organizations(id) on delete cascade,
  folio                    text not null,
  sold_at                  date not null,
  customer_id              uuid references customers(id),
  description              text not null,
  currency                 char(3) not null,
  subtotal_minor           bigint not null check (subtotal_minor >= 0),   -- antes de descuentos
  discount_minor           bigint not null default 0 check (discount_minor >= 0),
  tax_minor                bigint not null default 0 check (tax_minor >= 0),
  total_minor              bigint not null check (total_minor >= 0),
  payment_method           text,                                           -- CASH | CARD | TRANSFER | OTHER (método de cobro previsto)
  invoicing_flag           text check (invoicing_flag in ('PENDING', 'INCIDENT')),  -- lo que no se deriva de importes
  notes                    text,
  collected_minor          bigint not null default 0,                      -- caché: suma de cobros vigentes
  documented_minor         bigint not null default 0,                      -- caché: suma de CFDI ligados
  created_by_membership_id uuid references memberships(id),
  voided_at                timestamptz,
  void_reason              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (voided_at is null or void_reason is not null),
  unique (organization_id, folio)
);
create index if not exists sales_org_date_idx on sales (organization_id, sold_at desc);

create table if not exists sale_lines (
  id                uuid primary key default app.uuid_v7(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  sale_id           uuid not null references sales(id) on delete cascade,
  line_number       integer not null,
  description       text not null,
  quantity          numeric(18,4) not null check (quantity > 0),
  unit_price_minor  bigint not null check (unit_price_minor >= 0),
  discount_minor    bigint not null default 0 check (discount_minor >= 0),
  tax_rate          numeric(6,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 1),
  tax_minor         bigint not null default 0,
  total_minor       bigint not null,
  unique (sale_id, line_number)
);

create table if not exists cfdi_documents (
  id                      uuid primary key default app.uuid_v7(),
  organization_id         uuid not null references organizations(id) on delete cascade,
  direction               cfdi_direction not null,
  fiscal_uuid             text not null,
  cfdi_version            text,
  cfdi_type               text not null default 'I',            -- I ingreso, E egreso, P pago, T traslado, N nómina
  series                  text,
  folio                   text,
  issued_at               timestamptz,
  issuer_rfc              text not null,
  issuer_name             text,
  receiver_rfc            text not null,
  receiver_name           text,
  currency                char(3) not null,
  exchange_rate           numeric(18,6),
  subtotal_minor          bigint not null,
  discount_minor          bigint not null default 0,
  tax_minor               bigint not null default 0,
  total_minor             bigint not null,
  fiscal_payment_method   text,                                   -- PUE / PPD
  fiscal_payment_form     text,                                   -- clave SAT de forma de pago (01, 03, 99…)
  sat_status              text not null default 'UNKNOWN' check (sat_status in ('UNKNOWN', 'VIGENTE', 'CANCELADO')),
  sat_status_checked_at   timestamptz,
  xml_storage_key         text,
  xml_filename            text,
  pdf_storage_key         text,
  pdf_filename            text,
  source                  text not null check (source in ('MANUAL_UPLOAD', 'SUPPLIER_ORDER', 'PROVIDER_SYNC', 'PROVIDER_ISSUED')),
  provider                text,                                   -- p. ej. fiscalapi
  provider_external_id    text,
  last_synced_at          timestamptz,
  allocated_minor         bigint not null default 0,              -- caché: suma de lo ligado a operaciones
  created_by_membership_id uuid references memberships(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index if not exists cfdi_documents_uuid_uq on cfdi_documents (organization_id, upper(fiscal_uuid));
create index if not exists cfdi_documents_org_idx on cfdi_documents (organization_id, direction, issued_at desc);
create unique index if not exists cfdi_documents_provider_uq on cfdi_documents (organization_id, provider, provider_external_id) where provider_external_id is not null;

create table if not exists cfdi_links (
  id                       uuid primary key default app.uuid_v7(),
  organization_id          uuid not null references organizations(id) on delete cascade,
  cfdi_id                  uuid not null references cfdi_documents(id) on delete cascade,
  sale_id                  uuid references sales(id) on delete cascade,
  expense_id               uuid references expenses(id) on delete cascade,
  amount_minor             bigint not null check (amount_minor > 0),  -- lo que ESTE CFDI documenta de ESTA operación
  created_by_membership_id uuid references memberships(id),
  created_at               timestamptz not null default now(),
  check (num_nonnulls(sale_id, expense_id) = 1)
);
create unique index if not exists cfdi_links_sale_uq on cfdi_links (cfdi_id, sale_id) where sale_id is not null;
create unique index if not exists cfdi_links_expense_uq on cfdi_links (cfdi_id, expense_id) where expense_id is not null;
create index if not exists cfdi_links_sale_idx on cfdi_links (sale_id) where sale_id is not null;
create index if not exists cfdi_links_expense_idx on cfdi_links (expense_id) where expense_id is not null;

create table if not exists payments (
  id                       uuid primary key default app.uuid_v7(),
  organization_id          uuid not null references organizations(id) on delete cascade,
  direction                payment_direction not null,
  sale_id                  uuid references sales(id) on delete cascade,
  expense_id               uuid references expenses(id) on delete cascade,
  paid_at                  date not null,
  amount_minor             bigint not null check (amount_minor > 0),
  currency                 char(3) not null,
  method                   text,
  external_reference       text,
  notes                    text,
  created_by_membership_id uuid references memberships(id),
  voided_at                timestamptz,
  void_reason              text,
  created_at               timestamptz not null default now(),
  check (num_nonnulls(sale_id, expense_id) = 1),
  check ((direction = 'IN' and sale_id is not null) or (direction = 'OUT' and expense_id is not null)),
  check (voided_at is null or void_reason is not null)
);
create index if not exists payments_org_date_idx on payments (organization_id, direction, paid_at desc);
create index if not exists payments_sale_idx on payments (sale_id) where sale_id is not null;
create index if not exists payments_expense_idx on payments (expense_id) where expense_id is not null;

-- Conexión con un proveedor fiscal (sin secretos: las credenciales viven en variables de entorno / gestor de secretos).
create table if not exists fiscal_provider_connections (
  id                  uuid primary key default app.uuid_v7(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  provider            text not null,
  status              text not null default 'PENDING' check (status in ('PENDING', 'CONNECTED', 'ERROR')),
  external_account_id text,
  last_synced_at      timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, provider)
);

alter table expenses add column if not exists paid_minor bigint not null default 0;
alter table expenses add column if not exists documented_minor bigint not null default 0;
alter table supplier_invoices add column if not exists buyer_cfdi_id uuid references cfdi_documents(id);
alter table supplier_invoices add column if not exists supplier_cfdi_id uuid references cfdi_documents(id);

-- Migrar lo ya existente: cada factura de proveedor produce su CFDI recibido (comprador) y emitido (proveedor).
insert into cfdi_documents (organization_id, direction, fiscal_uuid, cfdi_version, cfdi_type, series, folio, issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name, currency, exchange_rate, subtotal_minor, tax_minor, total_minor, xml_storage_key, xml_filename, pdf_storage_key, pdf_filename, source)
select buyer_organization_id, 'RECEIVED', fiscal_uuid, cfdi_version, 'I', series, folio, issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name, currency, exchange_rate, subtotal_minor, tax_minor, total_minor, xml_storage_key, xml_filename, pdf_storage_key, pdf_filename, 'SUPPLIER_ORDER'
from supplier_invoices where status <> 'REJECTED' and buyer_cfdi_id is null on conflict do nothing;
insert into cfdi_documents (organization_id, direction, fiscal_uuid, cfdi_version, cfdi_type, series, folio, issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name, currency, exchange_rate, subtotal_minor, tax_minor, total_minor, xml_storage_key, xml_filename, pdf_storage_key, pdf_filename, source)
select supplier_organization_id, 'ISSUED', fiscal_uuid, cfdi_version, 'I', series, folio, issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name, currency, exchange_rate, subtotal_minor, tax_minor, total_minor, xml_storage_key, xml_filename, pdf_storage_key, pdf_filename, 'SUPPLIER_ORDER'
from supplier_invoices where status <> 'REJECTED' and supplier_cfdi_id is null on conflict do nothing;
update supplier_invoices s set buyer_cfdi_id = d.id from cfdi_documents d where d.organization_id = s.buyer_organization_id and upper(d.fiscal_uuid) = upper(s.fiscal_uuid) and s.buyer_cfdi_id is null and s.status <> 'REJECTED';
update supplier_invoices s set supplier_cfdi_id = d.id from cfdi_documents d where d.organization_id = s.supplier_organization_id and upper(d.fiscal_uuid) = upper(s.fiscal_uuid) and s.supplier_cfdi_id is null and s.status <> 'REJECTED';
-- expense_invoices → cfdi_links (importe documentado = el menor entre el gasto y el CFDI). La tabla queda sin uso.
insert into cfdi_links (organization_id, cfdi_id, expense_id, amount_minor)
select ei.organization_id, s.buyer_cfdi_id, ei.expense_id, greatest(least(e.amount_minor, s.total_minor), 1)
from expense_invoices ei join supplier_invoices s on s.id = ei.supplier_invoice_id join expenses e on e.id = ei.expense_id
where s.buyer_cfdi_id is not null on conflict do nothing;
update expenses e set documented_minor = coalesce((select sum(amount_minor) from cfdi_links l where l.expense_id = e.id), 0);
update cfdi_documents d set allocated_minor = coalesce((select sum(amount_minor) from cfdi_links l where l.cfdi_id = d.id), 0);
comment on table expense_invoices is 'OBSOLETA: reemplazada por cfdi_links (migrada el 2026-10-13). No se usa en el código.';

-- RLS: todo INTERNAL de la organización (cada una guarda su copia del dato fiscal).
do $$
declare t text;
begin
  foreach t in array array['customers','sales','sale_lines','cfdi_documents','cfdi_links','payments','fiscal_provider_connections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists p_internal on public.%I', t);
    execute format('create policy p_internal on public.%I for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org())', t);
    execute format('grant select, insert, update, delete on public.%I to procura_app', t);
  end loop;
end $$;

-- Permisos nuevos
insert into permissions (code, module, side, description) values
  ('sale.read',       'finance', 'ANY', 'Ver ventas e ingresos'),
  ('sale.manage',     'finance', 'ANY', 'Registrar y editar ventas'),
  ('payment.manage',  'finance', 'ANY', 'Registrar cobros y pagos'),
  ('cfdi.read',       'finance', 'ANY', 'Ver comprobantes fiscales (CFDI)'),
  ('cfdi.manage',     'finance', 'ANY', 'Cargar CFDI y ligarlos a ventas y gastos'),
  ('finance.read',    'finance', 'ANY', 'Ver el resumen financiero')
on conflict (code) do nothing;

insert into role_templates (name, description, permission_code)
select 'Administrador', 'Acceso total a la organización', code from permissions where code in ('sale.read','sale.manage','payment.manage','cfdi.read','cfdi.manage','finance.read')
union all select 'Finanzas', 'Visibilidad financiera y configuración de aprobaciones', unnest(array['sale.read','sale.manage','payment.manage','cfdi.read','cfdi.manage','finance.read'])
union all select 'Compras', 'Gestiona proveedores, cotizaciones y órdenes', unnest(array['cfdi.read'])
union all select 'Proveedor', 'Atiende RFQ, cotiza, confirma órdenes y registra entregas', unnest(array['cfdi.read'])
on conflict do nothing;
insert into role_permissions (role_id, permission_code, organization_id)
select r.id, t.permission_code, r.organization_id
from roles r join role_templates t on t.name = r.name
where r.is_system and t.permission_code in ('sale.read','sale.manage','payment.manage','cfdi.read','cfdi.manage','finance.read')
on conflict do nothing;
