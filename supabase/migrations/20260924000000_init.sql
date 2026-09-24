-- =============================================================================
-- PROCURA — Database schema  v0.1  (Supabase · PostgreSQL 15+)
-- -----------------------------------------------------------------------------
-- Fuente: docs/DOMAIN_MODEL.md · docs/WORKFLOWS.md · docs/RBAC.md · docs/OPEN_DECISIONS.md
-- Aplicar sobre una base vacía (no es idempotente). Ver docs/DATABASE_SCHEMA.md.
--
-- Convenciones
--   · Tablas INTERNAL  → organization_id NOT NULL
--   · Tablas SHARED    → buyer_organization_id + supplier_organization_id (+ relationship_id)
--   · Tablas hijas denormalizan las columnas de tenancy del padre (RLS simple + índices)
--   · Dinero: *_minor bigint + currency char(3) · Cantidades: numeric(18,4)
--   · Nada se borra: estados CANCELLED/REJECTED/CLOSED + motivo
--   · RLS activo en todo; el backend conecta como procura_app (NOBYPASSRLS) y hace
--     SET LOCAL app.organization_id / app.user_id por transacción.
-- =============================================================================

begin;

create extension if not exists citext;
create extension if not exists pgcrypto;

create schema if not exists app;

-- =============================================================================
-- 0. Helpers
-- =============================================================================

-- UUID v7 (ordenable por tiempo). Implementación estándar sobre gen_random_uuid().
create or replace function app.uuid_v7() returns uuid
language plpgsql volatile as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes := uuid_send(gen_random_uuid());
  uuid_bytes := overlay(uuid_bytes placing unix_ts_ms from 1 for 6);
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  return encode(uuid_bytes, 'hex')::uuid;
end $$;

-- Contexto de request (lo fija el backend con SET LOCAL)
create or replace function app.current_org() returns uuid
language sql stable as $$
  select nullif(current_setting('app.organization_id', true), '')::uuid
$$;

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =============================================================================
-- 1. Enums
-- =============================================================================

create type user_status              as enum ('ACTIVE','SUSPENDED');
create type organization_status      as enum ('ACTIVE','SUSPENDED');
create type membership_status        as enum ('PENDING','ACTIVE','SUSPENDED','REMOVED');
create type membership_requested_by  as enum ('USER','ORGANIZATION');
create type membership_join_policy   as enum ('INVITE_ONLY','REQUEST_APPROVAL');
create type relationship_request_policy as enum ('MANUAL_APPROVAL','AUTO_ACCEPT_VIA_INVITATION_ONLY');
create type reapproval_policy        as enum ('ALWAYS','IF_AMOUNT_INCREASES','NEVER');

create type invitation_kind          as enum ('MEMBERSHIP','RELATIONSHIP');
create type invitation_status        as enum ('ACTIVE','EXPIRED','REVOKED');
create type relationship_position    as enum ('BUYER','SUPPLIER');
create type relationship_status      as enum ('PENDING','ACTIVE','SUSPENDED','FINALIZED','REJECTED');
create type relationship_initiated_via as enum ('SEARCH','INVITATION','PORTAL');

create type permission_side          as enum ('BUYER','SUPPLIER','ANY');
create type scope_type               as enum ('ORGANIZATION','DEPARTMENT','LOCATION','RELATIONSHIP','CATEGORY','COST_CENTER','OPERATION_TYPE');
create type actor_type               as enum ('USER','API_KEY','SYSTEM');

create type item_type                as enum ('GOOD','SERVICE');
create type catalog_import_format    as enum ('CSV','XLSX');
create type catalog_import_status    as enum ('UPLOADED','MAPPED','VALIDATED','CONFIRMED','FAILED');
create type import_row_level         as enum ('OK','WARNING','ERROR');
create type import_row_action        as enum ('CREATE','UPDATE','SKIP');

create type requisition_status       as enum ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','IN_PROCESS','RESOLVED','CLOSED','REJECTED','CANCELLED');
create type requisition_priority     as enum ('LOW','NORMAL','HIGH','URGENT');
create type requisition_type         as enum ('GOODS','SERVICE','MIXED');
create type requisition_origin       as enum ('MANUAL','API','PORTAL','DUPLICATE','REORDER','TEMPLATE','SPLIT');
create type concept_source           as enum ('CATALOG','SUPPLIER_CATALOG','FREE');
create type concept_approval_status  as enum ('PENDING','APPROVED','REJECTED');

create type approval_workflow_mode   as enum ('WHOLE','PER_CONCEPT');
create type approver_type            as enum ('ROLE','MEMBERSHIP','DEPARTMENT_HEAD');
create type approver_scope_policy    as enum ('MATCH_REQUISITION_SCOPE','ANY');
create type decision_mode            as enum ('ANY_ONE','ALL');
create type approval_request_status  as enum ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED','SUPERSEDED');
create type approval_step_status     as enum ('PENDING','APPROVED','REJECTED','SKIPPED');
create type approval_decision_kind   as enum ('APPROVE','REJECT','REQUEST_CHANGES');

create type rfq_status               as enum ('SENT','VIEWED','QUOTED','DECLINED','WITHDRAWN','CLOSED');
create type quotation_status         as enum ('DRAFT','SUBMITTED','WITHDRAWN','SUPERSEDED','ACCEPTED','NOT_SELECTED','REJECTED','EXPIRED');
create type quotation_line_kind      as enum ('AS_REQUESTED','SUBSTITUTE','ALTERNATIVE_QUANTITY','ADDITIONAL','DECLINED');

create type order_status             as enum ('PENDING_CONFIRMATION','CONFIRMED','REJECTED','IN_PROCESS','COMPLETED','CANCELLED');
create type order_completion_mode    as enum ('FULL','CLOSED_SHORT');

create type delivery_status          as enum ('REGISTERED','RECEIVED','CANCELLED');
create type receipt_status           as enum ('PENDING','CONFIRMED','CONFIRMED_WITH_DISCREPANCIES');
create type discrepancy_type         as enum ('SHORTAGE','OVERAGE','DAMAGED','WRONG_ITEM','QUALITY','OTHER');

create type thread_anchor_type       as enum ('REQUISITION','REQUISITION_CONCEPT','RFQ','RFQ_LINE','QUOTATION','ORDER','DELIVERY');
create type visibility               as enum ('INTERNAL','SHARED');
create type attachment_anchor_type   as enum ('REQUISITION','REQUISITION_CONCEPT','RFQ','QUOTATION','ORDER','DELIVERY','RECEIPT','MESSAGE','CATALOG_IMPORT');
create type attachment_kind          as enum ('DOCUMENT','EVIDENCE','IMPORT_SOURCE');

create type event_perspective        as enum ('OWNER','BUYER','SUPPLIER');
create type webhook_delivery_status  as enum ('PENDING','SUCCEEDED','FAILED','EXHAUSTED');

-- =============================================================================
-- 2. Identity & Organizations
-- =============================================================================

-- Perfil 1:1 con auth.users (Supabase Auth, OD-35)
create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext not null unique,
  full_name     text not null default '',
  avatar_url    text,
  locale        text not null default 'es-MX',
  timezone      text not null default 'America/Mazatlan',
  status        user_status not null default 'ACTIVE',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

create table organizations (
  id                uuid primary key default app.uuid_v7(),
  slug              text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
  legal_name        text not null,
  display_name      text not null,
  tax_id            text,
  country           char(2) not null default 'MX',
  base_currency     char(3) not null default 'MXN' check (base_currency ~ '^[A-Z]{3}$'),
  timezone          text not null default 'America/Mazatlan',
  is_discoverable   boolean not null default false,          -- R-01: oculta por defecto
  status            organization_status not null default 'ACTIVE',
  created_by_user_id uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table organization_settings (
  organization_id                 uuid primary key references organizations(id) on delete cascade,
  requisition_folio_prefix        text not null default 'REQ-',
  allow_free_concepts             boolean not null default true,
  require_estimated_price         boolean not null default false,
  membership_join_policy          membership_join_policy not null default 'INVITE_ONLY',
  relationship_request_policy     relationship_request_policy not null default 'MANUAL_APPROVAL',
  requester_can_self_approve      boolean not null default false,             -- OD-21
  reapproval_policy               reapproval_policy not null default 'IF_AMOUNT_INCREASES', -- OD-07
  auto_close_days_after_resolved  integer check (auto_close_days_after_resolved is null or auto_close_days_after_resolved >= 0), -- OD-24
  portal_enabled                  boolean not null default false,
  portal_welcome_text             text,
  attachment_max_bytes            bigint not null default 26214400,          -- OD-27: 25 MB
  attachment_max_per_resource     integer not null default 20,
  updated_at                      timestamptz not null default now()
);

-- Secuencias por organización (folios humanos)
create table organization_sequences (
  organization_id uuid not null references organizations(id) on delete cascade,
  kind            text not null,
  next_value      bigint not null default 1,
  primary key (organization_id, kind)
);

create or replace function app.next_sequence(p_org uuid, p_kind text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into organization_sequences (organization_id, kind, next_value)
  values (p_org, p_kind, 2)
  on conflict (organization_id, kind) do update set next_value = organization_sequences.next_value + 1
  returning next_value - 1 into v;
  return v;
end $$;

create table departments (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  code            text,
  parent_id       uuid references departments(id),
  head_membership_id uuid,                       -- FK añadida tras memberships
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table locations (
  id                uuid primary key default app.uuid_v7(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  name              text not null,
  code              text,
  address           jsonb not null default '{}'::jsonb,
  contact_name      text,
  contact_phone     text,
  is_delivery_point boolean not null default true,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, name)
);

create table memberships (
  id                          uuid primary key default app.uuid_v7(),
  user_id                     uuid not null references users(id) on delete cascade,
  organization_id             uuid not null references organizations(id) on delete cascade,
  status                      membership_status not null default 'PENDING',
  requested_by                membership_requested_by not null,
  approved_by_membership_id   uuid references memberships(id),
  is_primary_admin            boolean not null default false,
  title                       text,
  default_department_id       uuid references departments(id),
  default_location_id         uuid references locations(id),
  activated_at                timestamptz,
  suspended_at                timestamptz,
  removed_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id, organization_id)
);
create unique index memberships_one_primary_admin on memberships (organization_id) where is_primary_admin;
create index memberships_org_status_idx on memberships (organization_id, status);

alter table departments
  add constraint departments_head_fk foreign key (head_membership_id) references memberships(id);

-- =============================================================================
-- 3. RBAC
-- =============================================================================

-- Catálogo estático (seed abajo). FK desde role_permissions garantiza integridad.
create table permissions (
  code        text primary key,
  module      text not null,
  side        permission_side not null default 'ANY',
  description text not null
);

create table roles (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  description     text,
  is_system       boolean not null default false,   -- rol base instanciado: editable, no eliminable
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code),
  organization_id uuid not null references organizations(id) on delete cascade,  -- denormalizado para RLS
  primary key (role_id, permission_code)
);

create table role_assignments (
  id                      uuid primary key default app.uuid_v7(),
  organization_id         uuid not null references organizations(id) on delete cascade,
  membership_id           uuid not null references memberships(id) on delete cascade,
  role_id                 uuid not null references roles(id) on delete cascade,
  scope_type              scope_type not null default 'ORGANIZATION',
  scope_id                uuid,
  granted_by_membership_id uuid references memberships(id),
  granted_at              timestamptz not null default now(),
  revoked_at              timestamptz,
  check ((scope_type = 'ORGANIZATION') = (scope_id is null))
);
create unique index role_assignments_unique_active
  on role_assignments (membership_id, role_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;
create index role_assignments_membership_idx on role_assignments (membership_id) where revoked_at is null;

-- Plantillas de roles base: se copian a cada organización al crearla
create table role_templates (
  name            text not null,
  description     text not null,
  permission_code text not null references permissions(code),
  primary key (name, permission_code)
);

create table invitations (
  id                    uuid primary key default app.uuid_v7(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  kind                  invitation_kind not null,
  token_hash            text not null unique,         -- sha256 del token; el token solo viaja en el link
  email                 citext,
  relationship_position relationship_position,        -- posición que tomará QUIEN ACEPTA (solo RELATIONSHIP)
  auto_accept           boolean not null default false,
  expires_at            timestamptz not null,
  max_uses              integer not null default 1 check (max_uses > 0),
  used_count            integer not null default 0 check (used_count >= 0),
  status                invitation_status not null default 'ACTIVE',
  created_by_membership_id uuid references memberships(id),
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  check ((kind = 'RELATIONSHIP') = (relationship_position is not null))
);

create table invitation_roles (
  invitation_id   uuid not null references invitations(id) on delete cascade,
  role_id         uuid not null references roles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  primary key (invitation_id, role_id)
);

-- Principal de integración (OD-22): porta roles como cualquier membership
create table api_keys (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  key_prefix      text not null,                    -- visible: pk_live_ab12…
  key_hash        text not null unique,             -- sha256 del secreto
  scope_type      scope_type not null default 'ORGANIZATION',
  scope_id        uuid,
  created_by_membership_id uuid references memberships(id),
  last_used_at    timestamptz,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  check ((scope_type = 'ORGANIZATION') = (scope_id is null))
);

create table api_key_roles (
  api_key_id      uuid not null references api_keys(id) on delete cascade,
  role_id         uuid not null references roles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  primary key (api_key_id, role_id)
);

-- =============================================================================
-- 4. Relationships (SHARED, direccional buyer → supplier, OD-12)
-- =============================================================================

create table relationships (
  id                          uuid primary key default app.uuid_v7(),
  buyer_organization_id       uuid not null references organizations(id),
  supplier_organization_id    uuid not null references organizations(id),
  status                      relationship_status not null default 'PENDING',
  initiated_by_organization_id uuid not null references organizations(id),
  initiated_via               relationship_initiated_via not null default 'SEARCH',
  request_message             text,
  accepted_at                 timestamptz,
  accepted_by_membership_id   uuid references memberships(id),
  rejected_at                 timestamptz,
  rejected_reason             text,
  suspended_at                timestamptz,
  suspended_by_organization_id uuid references organizations(id),
  suspended_reason            text,
  finalized_at                timestamptz,
  finalized_by_organization_id uuid references organizations(id),
  finalized_reason            text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (buyer_organization_id <> supplier_organization_id),
  check (initiated_by_organization_id in (buyer_organization_id, supplier_organization_id))
);
-- Una sola relación viva por par (buyer, supplier)
create unique index relationships_one_live_per_pair
  on relationships (buyer_organization_id, supplier_organization_id)
  where status in ('PENDING','ACTIVE','SUSPENDED');
create index relationships_buyer_idx on relationships (buyer_organization_id, status);
create index relationships_supplier_idx on relationships (supplier_organization_id, status);

create table relationship_terms (
  relationship_id               uuid primary key references relationships(id) on delete cascade,
  buyer_organization_id         uuid not null references organizations(id),
  supplier_organization_id      uuid not null references organizations(id),
  currency                      char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  payment_terms                 text,
  default_delivery_location_ids uuid[] not null default '{}',
  quotation_instructions        text,
  lead_time_days                integer check (lead_time_days is null or lead_time_days >= 0),
  updated_by_membership_id      uuid references memberships(id),
  updated_at                    timestamptz not null default now()
);

create table relationship_contacts (
  id                        uuid primary key default app.uuid_v7(),
  relationship_id           uuid not null references relationships(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  organization_id           uuid not null references organizations(id),   -- lado al que pertenece el contacto
  membership_id             uuid references memberships(id),
  name                      text not null,
  email                     citext,
  phone                     text,
  role_label                text,
  is_primary                boolean not null default false,
  created_at                timestamptz not null default now(),
  check (organization_id in (buyer_organization_id, supplier_organization_id))
);

-- =============================================================================
-- 5. Catalog (INTERNAL)
-- =============================================================================

create table units_of_measure (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid references organizations(id) on delete cascade,   -- NULL = global (OD-18)
  code            text not null,
  name            text not null,
  is_active       boolean not null default true
);
create unique index units_global_code on units_of_measure (code) where organization_id is null;
create unique index units_org_code on units_of_measure (organization_id, code) where organization_id is not null;

create table categories (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  parent_id       uuid references categories(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table catalog_items (
  id                uuid primary key default app.uuid_v7(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  sku               text not null,
  name              text not null,
  description       text,
  item_type         item_type not null default 'GOOD',
  unit_id           uuid references units_of_measure(id),
  unit_label        text not null,                          -- snapshot legible (viaja a RFQ/cotización)
  list_price_minor  bigint check (list_price_minor is null or list_price_minor >= 0),
  currency          char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  category_id       uuid references categories(id),
  attributes        jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, sku)
);
create index catalog_items_org_active_idx on catalog_items (organization_id) where is_active;
create index catalog_items_search_idx on catalog_items
  using gin (to_tsvector('spanish', coalesce(sku,'') || ' ' || coalesce(name,'') || ' ' || coalesce(description,'')));

-- Catálogo compartido con una relación (lado proveedor). Ítem o categoría.
create table catalog_shares (
  id                        uuid primary key default app.uuid_v7(),
  relationship_id           uuid not null references relationships(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  catalog_item_id           uuid references catalog_items(id) on delete cascade,
  category_id               uuid references categories(id) on delete cascade,
  show_price                boolean not null default false,          -- OD-19
  is_active                 boolean not null default true,
  created_by_membership_id  uuid references memberships(id),
  created_at                timestamptz not null default now(),
  check (num_nonnulls(catalog_item_id, category_id) = 1)
);
create unique index catalog_shares_item_unique on catalog_shares (relationship_id, catalog_item_id) where catalog_item_id is not null;
create unique index catalog_shares_category_unique on catalog_shares (relationship_id, category_id) where category_id is not null;

create table catalog_imports (
  id                    uuid primary key default app.uuid_v7(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  format                catalog_import_format not null,
  status                catalog_import_status not null default 'UPLOADED',
  source_attachment_id  uuid,                                  -- FK tras attachments
  detected_columns      jsonb not null default '[]'::jsonb,
  column_mapping        jsonb not null default '{}'::jsonb,
  summary               jsonb not null default '{}'::jsonb,    -- {total, valid, warnings, errors, created, updated}
  error_message         text,
  created_by_membership_id uuid references memberships(id),
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table catalog_import_rows (
  import_id       uuid not null references catalog_imports(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  row_number      integer not null,
  raw             jsonb not null,
  normalized      jsonb,
  level           import_row_level not null default 'OK',
  messages        jsonb not null default '[]'::jsonb,
  action          import_row_action,
  primary key (import_id, row_number)
);

-- =============================================================================
-- 6. Requisitions (INTERNAL al comprador)
-- =============================================================================

create table requisitions (
  id                                uuid primary key default app.uuid_v7(),
  organization_id                   uuid not null references organizations(id) on delete cascade,
  folio                             text not null,
  requisition_type                  requisition_type not null default 'GOODS',   -- derivado de conceptos (app)
  title                             text not null,
  description                       text,
  priority                          requisition_priority not null default 'NORMAL',
  required_date                     date,
  status                            requisition_status not null default 'DRAFT',
  version                           integer not null default 1,
  approved_version                  integer,
  -- origin
  requester_membership_id           uuid references memberships(id),
  department_id                     uuid references departments(id),
  location_id                       uuid references locations(id),
  origin_type                       requisition_origin not null default 'MANUAL',
  origin_system                     text,
  external_reference                text,
  origin_api_key_id                 uuid references api_keys(id),
  derived_from_requisition_id       uuid references requisitions(id),
  parent_requisition_id             uuid references requisitions(id),       -- OD-03: split
  template_id                       uuid,                                    -- FK tras templates
  -- destination
  suggested_supplier_organization_id uuid references organizations(id),
  directed_supplier_organization_id uuid references organizations(id),       -- OD-02
  destination_contact               text,
  delivery_location_id              uuid references locations(id),
  -- private
  budget_max_minor                  bigint check (budget_max_minor is null or budget_max_minor >= 0),
  currency                          char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  estimated_total_minor             bigint not null default 0,
  -- lifecycle
  submitted_at                      timestamptz,
  approved_at                       timestamptz,
  sent_at                           timestamptz,
  resolved_at                       timestamptz,
  closed_at                         timestamptz,
  rejected_at                       timestamptz,
  cancelled_at                      timestamptz,
  cancelled_by_membership_id        uuid references memberships(id),
  cancel_reason                     text,
  order_id                          uuid,                                    -- FK tras orders (orden viva)
  search_vector                     tsvector generated always as (
                                      to_tsvector('spanish', coalesce(folio,'') || ' ' || coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(external_reference,''))
                                    ) stored,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  unique (organization_id, folio),
  check (status <> 'CANCELLED' or cancel_reason is not null)
);
create index requisitions_org_status_idx on requisitions (organization_id, status, created_at desc);
create index requisitions_org_dept_idx on requisitions (organization_id, department_id);
create index requisitions_org_loc_idx on requisitions (organization_id, location_id);
create index requisitions_requester_idx on requisitions (requester_membership_id);
create index requisitions_external_ref_idx on requisitions (organization_id, external_reference) where external_reference is not null;
create index requisitions_search_idx on requisitions using gin (search_vector);

create table requisition_concepts (
  id                          uuid primary key default app.uuid_v7(),
  requisition_id              uuid not null references requisitions(id) on delete cascade,
  organization_id             uuid not null references organizations(id) on delete cascade,
  line_number                 integer not null,
  concept_type                item_type not null,
  source                      concept_source not null,
  catalog_item_id             uuid references catalog_items(id),
  supplier_catalog_item_id    uuid references catalog_items(id),
  name                        text not null,
  description                 text,
  specifications              jsonb not null default '{}'::jsonb,
  quantity                    numeric(18,4) not null check (quantity > 0),
  unit_id                     uuid references units_of_measure(id),
  unit_label                  text not null,
  estimated_unit_price_minor  bigint check (estimated_unit_price_minor is null or estimated_unit_price_minor >= 0),
  budget_minor                bigint check (budget_minor is null or budget_minor >= 0),
  required_date               date,
  location_id                 uuid references locations(id),
  approval_status             concept_approval_status not null default 'PENDING',    -- OD-08 (modelado)
  fulfilled_quantity          numeric(18,4) not null default 0 check (fulfilled_quantity >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (requisition_id, line_number),
  check ((source = 'CATALOG') = (catalog_item_id is not null)),
  check ((source = 'SUPPLIER_CATALOG') = (supplier_catalog_item_id is not null))
);

create table requisition_templates (
  id                        uuid primary key default app.uuid_v7(),
  organization_id           uuid not null references organizations(id) on delete cascade,
  name                      text not null,
  description               text,
  payload                   jsonb not null,             -- snapshot header + conceptos
  created_by_membership_id  uuid references memberships(id),
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organization_id, name)
);
alter table requisitions add constraint requisitions_template_fk foreign key (template_id) references requisition_templates(id);

-- =============================================================================
-- 7. Approvals (INTERNAL)
-- =============================================================================

create table approval_workflows (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  mode            approval_workflow_mode not null default 'WHOLE',
  applies_to      jsonb not null default '{}'::jsonb,   -- {requisition_types?, department_ids?, location_ids?}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create unique index approval_workflows_one_default on approval_workflows (organization_id) where is_default and is_active;

create table approval_rules (
  id                      uuid primary key default app.uuid_v7(),
  workflow_id             uuid not null references approval_workflows(id) on delete cascade,
  organization_id         uuid not null references organizations(id) on delete cascade,
  level                   integer not null check (level >= 1),
  condition               jsonb not null default '{}'::jsonb,   -- {min_amount_minor?, max_amount_minor?, department_ids?, requisition_types?, category_ids?}
  approver_type           approver_type not null,
  approver_role_id        uuid references roles(id),
  approver_membership_id  uuid references memberships(id),
  approver_scope_policy   approver_scope_policy not null default 'MATCH_REQUISITION_SCOPE',
  decision_mode           decision_mode not null default 'ANY_ONE',   -- OD-32
  created_at              timestamptz not null default now(),
  unique (workflow_id, level),
  check (
    (approver_type = 'ROLE'            and approver_role_id is not null and approver_membership_id is null) or
    (approver_type = 'MEMBERSHIP'      and approver_membership_id is not null and approver_role_id is null) or
    (approver_type = 'DEPARTMENT_HEAD' and approver_role_id is null and approver_membership_id is null)
  )
);

create table approval_requests (
  id                    uuid primary key default app.uuid_v7(),
  requisition_id        uuid not null references requisitions(id) on delete cascade,
  organization_id       uuid not null references organizations(id) on delete cascade,
  requisition_version   integer not null,
  workflow_id           uuid references approval_workflows(id),
  status                approval_request_status not null default 'PENDING',
  current_level         integer,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz
);
create unique index approval_requests_one_pending on approval_requests (requisition_id) where status = 'PENDING';

create table approval_steps (
  id                                uuid primary key default app.uuid_v7(),
  approval_request_id               uuid not null references approval_requests(id) on delete cascade,
  organization_id                   uuid not null references organizations(id) on delete cascade,
  level                             integer not null,
  rule_id                           uuid references approval_rules(id),
  decision_mode                     decision_mode not null,
  status                            approval_step_status not null default 'PENDING',
  resolved_approver_membership_ids  uuid[] not null default '{}',     -- snapshot
  resolved_at                       timestamptz,
  unique (approval_request_id, level)
);

create table approval_decisions (
  id              uuid primary key default app.uuid_v7(),
  step_id         uuid not null references approval_steps(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id   uuid not null references memberships(id),
  decision        approval_decision_kind not null,
  comment         text,
  concept_id      uuid references requisition_concepts(id),       -- PER_CONCEPT
  decided_at      timestamptz not null default now()
);

-- =============================================================================
-- 8. Sourcing (SHARED)
-- =============================================================================

create sequence rfq_number_seq;
create sequence quotation_number_seq;
create sequence order_number_seq;

create table quotation_requests (
  id                        uuid primary key default app.uuid_v7(),
  requisition_id            uuid not null references requisitions(id),       -- interno; nunca se expone al proveedor
  relationship_id           uuid not null references relationships(id),
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  rfq_number                text not null unique default ('RFQ-' || lpad(nextval('rfq_number_seq')::text, 6, '0')),
  status                    rfq_status not null default 'SENT',
  due_date                  date,
  message                   text,
  required_date             date,
  delivery_locations        jsonb not null default '[]'::jsonb,   -- snapshot compartido
  issued_by_membership_id   uuid references memberships(id),
  viewed_at                 timestamptz,
  declined_at               timestamptz,
  declined_reason           text,
  withdrawn_at              timestamptz,
  closed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index rfq_one_live_per_supplier
  on quotation_requests (requisition_id, supplier_organization_id)
  where status in ('SENT','VIEWED','QUOTED');
create index rfq_supplier_idx on quotation_requests (supplier_organization_id, status);
create index rfq_buyer_idx on quotation_requests (buyer_organization_id, status);

create table quotation_request_lines (
  id                        uuid primary key default app.uuid_v7(),
  rfq_id                    uuid not null references quotation_requests(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  requisition_concept_id    uuid not null references requisition_concepts(id),   -- interno
  line_number               integer not null,
  name                      text not null,
  description               text,
  specifications            jsonb not null default '{}'::jsonb,
  quantity                  numeric(18,4) not null check (quantity > 0),
  unit_label                text not null,
  required_date             date,
  delivery_location         jsonb,                                              -- snapshot
  supplier_catalog_item_id  uuid references catalog_items(id),
  unique (rfq_id, line_number)
);

create table quotations (
  id                        uuid primary key default app.uuid_v7(),
  rfq_id                    uuid not null references quotation_requests(id),
  relationship_id           uuid not null references relationships(id),
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  quotation_number          text not null unique default ('QT-' || lpad(nextval('quotation_number_seq')::text, 6, '0')),
  version                   integer not null default 1,                 -- OD-04
  status                    quotation_status not null default 'DRAFT',
  currency                  char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor            bigint not null default 0 check (subtotal_minor >= 0),
  tax_minor                 bigint not null default 0 check (tax_minor >= 0),
  total_minor               bigint not null default 0 check (total_minor >= 0),
  valid_until               date,
  lead_time_days            integer check (lead_time_days is null or lead_time_days >= 0),
  delivery_terms            text,
  payment_terms             text,
  notes                     text,
  submitted_at              timestamptz,
  submitted_by_membership_id uuid references memberships(id),
  withdrawn_at              timestamptz,
  accepted_at               timestamptz,
  accepted_by_membership_id uuid references memberships(id),
  rejected_at               timestamptz,
  rejected_reason           text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (rfq_id, version),
  check (status <> 'SUBMITTED' or valid_until is not null),
  check (subtotal_minor + tax_minor = total_minor)                       -- OD-17
);
create unique index quotations_one_submitted_per_rfq on quotations (rfq_id) where status = 'SUBMITTED';
create index quotations_supplier_idx on quotations (supplier_organization_id, status);
create index quotations_buyer_idx on quotations (buyer_organization_id, status);

create table quotation_lines (
  id                        uuid primary key default app.uuid_v7(),
  quotation_id              uuid not null references quotations(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  line_number               integer not null,
  rfq_line_id               uuid references quotation_request_lines(id),
  line_kind                 quotation_line_kind not null default 'AS_REQUESTED',
  supplier_catalog_item_id  uuid references catalog_items(id),
  name                      text not null,
  description               text,
  specifications            jsonb not null default '{}'::jsonb,
  quantity                  numeric(18,4) not null default 0 check (quantity >= 0),
  unit_label                text not null default '',
  unit_price_minor          bigint not null default 0 check (unit_price_minor >= 0),
  line_total_minor          bigint not null default 0 check (line_total_minor >= 0),
  lead_time_days            integer,
  notes                     text,
  unique (quotation_id, line_number),
  check ((line_kind = 'ADDITIONAL') = (rfq_line_id is null))
);

-- Lado privado del proveedor (nunca visible al comprador)
create table quotation_supplier_private (
  quotation_id              uuid primary key references quotations(id) on delete cascade,
  organization_id           uuid not null references organizations(id),      -- = supplier
  assigned_membership_id    uuid references memberships(id),
  internal_cost_minor       bigint check (internal_cost_minor is null or internal_cost_minor >= 0),
  margin_pct                numeric(7,4),
  internal_supplier_ref     text,
  internal_notes            text,
  updated_at                timestamptz not null default now()
);

-- =============================================================================
-- 9. Orders (SHARED)
-- =============================================================================

create table orders (
  id                            uuid primary key default app.uuid_v7(),
  requisition_id                uuid not null references requisitions(id),     -- interno del comprador
  quotation_id                  uuid not null unique references quotations(id),
  relationship_id               uuid not null references relationships(id),
  buyer_organization_id         uuid not null references organizations(id),
  supplier_organization_id      uuid not null references organizations(id),
  order_number                  text not null unique default ('PRC-' || lpad(nextval('order_number_seq')::text, 6, '0')),  -- OD-16
  buyer_reference               text,
  supplier_reference            text,
  status                        order_status not null default 'PENDING_CONFIRMATION',
  version                       integer not null default 1,
  currency                      char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor                bigint not null check (subtotal_minor >= 0),
  tax_minor                     bigint not null check (tax_minor >= 0),
  total_minor                   bigint not null check (total_minor >= 0),
  payment_terms                 text,
  delivery_terms                text,
  required_date                 date,
  confirmed_at                  timestamptz,
  confirmed_by_membership_id    uuid references memberships(id),
  rejected_at                   timestamptz,
  rejected_by_membership_id     uuid references memberships(id),
  rejected_reason               text,
  started_at                    timestamptz,
  started_by_membership_id      uuid references memberships(id),
  cancelled_at                  timestamptz,
  cancelled_by_membership_id    uuid references memberships(id),
  cancelled_by_organization_id  uuid references organizations(id),
  cancel_reason                 text,
  completed_at                  timestamptz,
  completion_mode               order_completion_mode,
  completion_reason             text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check (status <> 'CANCELLED' or (cancel_reason is not null and cancelled_by_organization_id is not null)),
  check (status <> 'REJECTED'  or rejected_reason is not null),
  check ((status = 'COMPLETED') = (completion_mode is not null))
);
-- Una requisición → una orden viva (regla 6)
create unique index orders_one_live_per_requisition on orders (requisition_id) where status not in ('REJECTED','CANCELLED');
create index orders_buyer_idx on orders (buyer_organization_id, status, created_at desc);
create index orders_supplier_idx on orders (supplier_organization_id, status, created_at desc);

alter table requisitions add constraint requisitions_order_fk foreign key (order_id) references orders(id);

create table order_lines (
  id                        uuid primary key default app.uuid_v7(),
  order_id                  uuid not null references orders(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  line_number               integer not null,
  quotation_line_id         uuid not null references quotation_lines(id),
  requisition_concept_id    uuid references requisition_concepts(id),
  name                      text not null,
  description               text,
  quantity                  numeric(18,4) not null check (quantity > 0),
  unit_label                text not null,
  unit_price_minor          bigint not null check (unit_price_minor >= 0),
  line_total_minor          bigint not null check (line_total_minor >= 0),
  delivery_location         jsonb,
  delivered_quantity        numeric(18,4) not null default 0 check (delivered_quantity >= 0),   -- mantenidas por la app en la misma tx
  received_quantity         numeric(18,4) not null default 0 check (received_quantity >= 0),
  accepted_quantity         numeric(18,4) not null default 0 check (accepted_quantity >= 0),
  unique (order_id, line_number)
);

-- Lado privado por organización sobre la orden
create table order_party_private (
  order_id                uuid not null references orders(id) on delete cascade,
  organization_id         uuid not null references organizations(id),
  cost_center_ref         text,
  internal_supplier_ref   text,
  assigned_membership_id  uuid references memberships(id),
  internal_notes          text,
  custom                  jsonb not null default '{}'::jsonb,
  updated_at              timestamptz not null default now(),
  primary key (order_id, organization_id)
);

-- =============================================================================
-- 10. Fulfillment (SHARED)
-- =============================================================================

create table deliveries (
  id                          uuid primary key default app.uuid_v7(),
  order_id                    uuid not null references orders(id),
  relationship_id             uuid not null references relationships(id),
  buyer_organization_id       uuid not null references organizations(id),
  supplier_organization_id    uuid not null references organizations(id),
  delivery_number             integer not null,                              -- #1, #2… por orden
  status                      delivery_status not null default 'REGISTERED',
  delivered_at                timestamptz not null,
  location_id                 uuid references locations(id),                 -- localización del comprador
  location_snapshot           jsonb,
  carrier                     text,
  tracking_ref                text,
  notes                       text,
  registered_by_membership_id uuid references memberships(id),
  cancelled_at                timestamptz,
  cancel_reason               text,
  replacement_of_return_id    uuid,                                          -- reservado (post-MVP, OD-23)
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (order_id, delivery_number),
  check (status <> 'CANCELLED' or cancel_reason is not null)
);
create index deliveries_buyer_loc_idx on deliveries (buyer_organization_id, location_id, status);

create table delivery_lines (
  id                        uuid primary key default app.uuid_v7(),
  delivery_id               uuid not null references deliveries(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  order_line_id             uuid not null references order_lines(id),
  quantity_delivered        numeric(18,4) not null check (quantity_delivered > 0),
  notes                     text,
  unique (delivery_id, order_line_id)
);

create table receipts (
  id                        uuid primary key default app.uuid_v7(),
  delivery_id               uuid not null unique references deliveries(id),
  order_id                  uuid not null references orders(id),
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  status                    receipt_status not null default 'PENDING',
  confirmed_at              timestamptz,
  confirmed_by_membership_id uuid references memberships(id),
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check ((status = 'PENDING') = (confirmed_at is null))
);

create table receipt_lines (
  id                        uuid primary key default app.uuid_v7(),
  receipt_id                uuid not null references receipts(id) on delete cascade,
  buyer_organization_id     uuid not null references organizations(id),
  supplier_organization_id  uuid not null references organizations(id),
  delivery_line_id          uuid not null references delivery_lines(id),
  quantity_received         numeric(18,4) not null check (quantity_received >= 0),
  quantity_accepted         numeric(18,4) not null check (quantity_accepted >= 0),
  quantity_rejected         numeric(18,4) not null check (quantity_rejected >= 0),
  discrepancy_type          discrepancy_type,
  discrepancy_notes         text,
  unique (receipt_id, delivery_line_id),
  check (quantity_received = quantity_accepted + quantity_rejected),          -- invariante 7
  check (quantity_rejected = 0 or discrepancy_type is not null)
);

-- =============================================================================
-- 11. Collaboration
-- =============================================================================

-- Hilo: INTERNAL (organization_id) o SHARED (buyer/supplier). La requisición solo admite INTERNAL.
create table threads (
  id                        uuid primary key default app.uuid_v7(),
  anchor_type               thread_anchor_type not null,
  anchor_id                 uuid not null,
  visibility                visibility not null,
  organization_id           uuid references organizations(id),
  relationship_id           uuid references relationships(id),
  buyer_organization_id     uuid references organizations(id),
  supplier_organization_id  uuid references organizations(id),
  created_at                timestamptz not null default now(),
  check (
    (visibility = 'INTERNAL' and organization_id is not null and relationship_id is null) or
    (visibility = 'SHARED'   and organization_id is null and relationship_id is not null and buyer_organization_id is not null and supplier_organization_id is not null)
  ),
  check (not (visibility = 'SHARED' and anchor_type in ('REQUISITION','REQUISITION_CONCEPT')))
);
create unique index threads_internal_unique on threads (anchor_type, anchor_id, organization_id) where visibility = 'INTERNAL';
create unique index threads_shared_unique   on threads (anchor_type, anchor_id) where visibility = 'SHARED';

create table messages (
  id                        uuid primary key default app.uuid_v7(),
  thread_id                 uuid not null references threads(id) on delete cascade,
  visibility                visibility not null,
  organization_id           uuid references organizations(id),
  buyer_organization_id     uuid references organizations(id),
  supplier_organization_id  uuid references organizations(id),
  author_membership_id      uuid not null references memberships(id),
  author_organization_id    uuid not null references organizations(id),
  body                      text not null,
  created_at                timestamptz not null default now(),
  edited_at                 timestamptz
);
create index messages_thread_idx on messages (thread_id, created_at);

create table attachments (
  id                        uuid primary key default app.uuid_v7(),
  owner_organization_id     uuid not null references organizations(id),
  uploaded_by_membership_id uuid references memberships(id),
  anchor_type               attachment_anchor_type not null,
  anchor_id                 uuid not null,
  visibility                visibility not null default 'INTERNAL',
  buyer_organization_id     uuid references organizations(id),
  supplier_organization_id  uuid references organizations(id),
  kind                      attachment_kind not null default 'DOCUMENT',
  storage_bucket            text not null default 'attachments',
  storage_key               text not null unique,
  filename                  text not null,
  mime_type                 text not null,
  size_bytes                bigint not null check (size_bytes > 0),
  checksum_sha256           text,
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  check (visibility = 'INTERNAL' or (buyer_organization_id is not null and supplier_organization_id is not null)),
  check (not (visibility = 'SHARED' and anchor_type in ('REQUISITION','REQUISITION_CONCEPT','CATALOG_IMPORT')))
);
create index attachments_anchor_idx on attachments (anchor_type, anchor_id) where deleted_at is null;

alter table catalog_imports add constraint catalog_imports_source_fk foreign key (source_attachment_id) references attachments(id);

-- =============================================================================
-- 12. Events, notifications, webhooks, audit, idempotency
-- =============================================================================

-- Outbox: una fila por (evento, organización receptora) con payload ya filtrado por perspectiva
create table domain_events (
  id                uuid primary key default app.uuid_v7(),
  event_key         uuid not null,                         -- agrupa los envelopes del mismo hecho
  type              text not null,
  schema_version    integer not null default 1,
  occurred_at       timestamptz not null default now(),
  aggregate_type    text not null,
  aggregate_id      uuid not null,
  organization_id   uuid not null references organizations(id),    -- receptora
  perspective       event_perspective not null,
  actor             jsonb not null,
  payload           jsonb not null,
  dispatched_at     timestamptz,
  unique (event_key, organization_id)
);
create index domain_events_undispatched_idx on domain_events (occurred_at) where dispatched_at is null;
create index domain_events_org_feed_idx on domain_events (organization_id, id);   -- GET /events?since=

create table notifications (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id   uuid not null references memberships(id) on delete cascade,
  event_id        uuid references domain_events(id),
  type            text not null,
  title           text not null,
  body            text,
  resource_type   text,
  resource_id     uuid,
  read_at         timestamptz,
  emailed_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index notifications_inbox_idx on notifications (membership_id, created_at desc) where read_at is null;

create table webhook_endpoints (
  id              uuid primary key default app.uuid_v7(),
  organization_id uuid not null references organizations(id) on delete cascade,
  url             text not null check (url ~ '^https://'),
  secret_hash     text not null,
  event_types     text[] not null default '{*}',
  payload_mode    text not null default 'full' check (payload_mode in ('full','thin')),
  is_active       boolean not null default true,
  consecutive_failures integer not null default 0,
  disabled_reason text,
  created_by_membership_id uuid references memberships(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table webhook_deliveries (
  id              uuid primary key default app.uuid_v7(),
  endpoint_id     uuid not null references webhook_endpoints(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id        uuid not null references domain_events(id),
  attempt         integer not null default 1,
  status          webhook_delivery_status not null default 'PENDING',
  response_status integer,
  response_body   text,                                    -- truncado a 4 KB por la app
  error           text,
  next_retry_at   timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index webhook_deliveries_retry_idx on webhook_deliveries (next_retry_at) where status = 'PENDING';
create index webhook_deliveries_endpoint_idx on webhook_deliveries (endpoint_id, created_at desc);

-- Append-only. procura_app no tiene UPDATE/DELETE (ver grants).
create table audit_logs (
  id                          uuid primary key default app.uuid_v7(),
  occurred_at                 timestamptz not null default now(),
  actor_type                  actor_type not null,
  actor_id                    uuid,
  membership_id               uuid,
  api_key_id                  uuid,
  organization_id             uuid not null,                  -- contexto en que actuó
  visible_to_organization_ids uuid[] not null,
  action                      text not null,
  resource_type               text not null,
  resource_id                 uuid,
  resource_label              text,
  changes                     jsonb,
  reason                      text,
  metadata                    jsonb not null default '{}'::jsonb
);
create index audit_logs_resource_idx on audit_logs (resource_type, resource_id, occurred_at desc);
create index audit_logs_visible_idx on audit_logs using gin (visible_to_organization_ids);
create index audit_logs_org_time_idx on audit_logs (organization_id, occurred_at desc);

create table idempotency_keys (
  organization_id uuid not null references organizations(id) on delete cascade,
  key             text not null,
  request_hash    text not null,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours',
  primary key (organization_id, key)
);

-- =============================================================================
-- 13. updated_at triggers (todas las tablas con la columna)
-- =============================================================================

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- =============================================================================
-- 14. Seed: permisos y plantillas de roles base (docs/RBAC.md §2–3)
-- =============================================================================

insert into permissions (code, module, side, description) values
  ('organization.read','organization','ANY','Ver ficha y configuración'),
  ('organization.update','organization','ANY','Editar ficha'),
  ('settings.manage','organization','ANY','Editar configuración'),
  ('department.manage','organization','ANY','CRUD departamentos'),
  ('location.manage','organization','ANY','CRUD localizaciones'),
  ('member.read','organization','ANY','Ver miembros'),
  ('member.invite','organization','ANY','Invitar miembros'),
  ('member.approve','organization','ANY','Aprobar solicitudes de membership'),
  ('member.manage','organization','ANY','Suspender/remover miembros'),
  ('role.read','organization','ANY','Ver roles'),
  ('role.manage','organization','ANY','Crear/editar roles'),
  ('role.assign','organization','ANY','Asignar/revocar roles'),
  ('admin.transfer_primary','organization','ANY','Transferir administrador principal'),
  ('audit.read','organization','ANY','Consultar bitácora'),
  ('api_key.manage','integration','ANY','Gestionar API keys'),
  ('webhook.manage','integration','ANY','Gestionar webhooks'),
  ('approval_workflow.manage','approvals','ANY','Configurar aprobaciones'),
  ('relationship.read','relationships','ANY','Ver relaciones'),
  ('relationship.request','relationships','ANY','Solicitar relaciones e invitar'),
  ('relationship.accept','relationships','ANY','Aceptar/rechazar relaciones'),
  ('relationship.manage','relationships','ANY','Suspender/finalizar; términos y contactos'),
  ('catalog.read','catalog','ANY','Ver catálogo propio'),
  ('catalog.manage','catalog','ANY','CRUD catálogo'),
  ('catalog.import','catalog','ANY','Importar catálogo'),
  ('catalog.share','catalog','SUPPLIER','Compartir catálogo con relaciones'),
  ('shared_catalog.read','catalog','BUYER','Consultar catálogos compartidos'),
  ('requisition.read','requisitions','BUYER','Ver requisiciones (scope)'),
  ('requisition.read_all','requisitions','BUYER','Ver todas las requisiciones'),
  ('requisition.create','requisitions','BUYER','Crear requisiciones'),
  ('requisition.update','requisitions','BUYER','Editar propias en DRAFT'),
  ('requisition.update_any','requisitions','BUYER','Editar cualquier requisición'),
  ('requisition.submit','requisitions','BUYER','Enviar a aprobación'),
  ('requisition.cancel','requisitions','BUYER','Cancelar requisiciones'),
  ('requisition.close','requisitions','BUYER','Cerrar requisiciones'),
  ('requisition.approve','requisitions','BUYER','Aprobar/rechazar/solicitar cambios'),
  ('requisition.read_private','requisitions','BUYER','Ver presupuesto y precios estimados'),
  ('template.manage','requisitions','BUYER','Gestionar plantillas'),
  ('rfq.issue','sourcing','BUYER','Emitir/retirar RFQ'),
  ('quotation.read','sourcing','BUYER','Ver y comparar cotizaciones'),
  ('quotation.accept','sourcing','BUYER','Aceptar/rechazar cotizaciones'),
  ('order.read','orders','ANY','Ver órdenes'),
  ('order.cancel','orders','ANY','Cancelar órdenes'),
  ('order.close_short','orders','BUYER','Cerrar orden con pendientes'),
  ('receipt.confirm','fulfillment','BUYER','Confirmar recepción'),
  ('rfq.read','sourcing','SUPPLIER','Ver RFQ recibidas'),
  ('rfq.decline','sourcing','SUPPLIER','Declinar cotizar'),
  ('quotation.submit','sourcing','SUPPLIER','Crear/enviar/retirar cotizaciones'),
  ('quotation.read_private','sourcing','SUPPLIER','Ver/editar datos privados de cotización'),
  ('order.confirm','orders','SUPPLIER','Confirmar o rechazar orden'),
  ('order.start','orders','SUPPLIER','Marcar orden en proceso'),
  ('delivery.register','fulfillment','SUPPLIER','Registrar/editar/cancelar entregas'),
  ('conversation.shared.read','collaboration','ANY','Leer conversaciones compartidas'),
  ('conversation.shared.post','collaboration','ANY','Escribir en conversaciones compartidas'),
  ('note.internal.read','collaboration','ANY','Leer notas internas'),
  ('note.internal.post','collaboration','ANY','Escribir notas internas'),
  ('attachment.upload','collaboration','ANY','Subir adjuntos'),
  ('attachment.delete_own','collaboration','ANY','Eliminar adjuntos propios');

-- Plantillas de roles base
insert into role_templates (name, description, permission_code)
select 'Administrador', 'Acceso total a la organización', code from permissions
union all
select 'Solicitante', 'Crea y sigue sus requisiciones', unnest(array[
  'requisition.read','requisition.create','requisition.update','requisition.submit','requisition.cancel',
  'template.manage','catalog.read','shared_catalog.read','note.internal.read','note.internal.post',
  'attachment.upload','attachment.delete_own','order.read','receipt.confirm','organization.read'])
union all
select 'Compras', 'Gestiona proveedores, cotizaciones y órdenes', unnest(array[
  'requisition.read','requisition.read_all','requisition.create','requisition.update','requisition.update_any',
  'requisition.submit','requisition.cancel','requisition.close','requisition.read_private','template.manage',
  'rfq.issue','quotation.read','quotation.accept','order.read','order.cancel','order.close_short','receipt.confirm',
  'relationship.read','relationship.request','relationship.accept','catalog.read','shared_catalog.read',
  'conversation.shared.read','conversation.shared.post','note.internal.read','note.internal.post',
  'attachment.upload','attachment.delete_own','organization.read','member.read'])
union all
select 'Aprobador', 'Aprueba requisiciones dentro de su scope', unnest(array[
  'requisition.read','requisition.approve','requisition.read_private','note.internal.read','note.internal.post','organization.read'])
union all
select 'Finanzas', 'Visibilidad financiera y configuración de aprobaciones', unnest(array[
  'requisition.read_all','requisition.read_private','order.read','audit.read','approval_workflow.manage','organization.read'])
union all
select 'Proveedor', 'Atiende RFQ, cotiza, confirma órdenes y registra entregas', unnest(array[
  'rfq.read','rfq.decline','quotation.submit','quotation.read_private','order.read','order.confirm','order.start',
  'order.cancel','delivery.register','conversation.shared.read','conversation.shared.post','note.internal.read',
  'note.internal.post','catalog.read','catalog.share','relationship.read','relationship.accept',
  'attachment.upload','attachment.delete_own','organization.read'])
union all
select 'Cliente', 'Solicita y recibe a través del portal', unnest(array[
  'requisition.read','requisition.create','requisition.update','requisition.submit','requisition.cancel',
  'quotation.read','quotation.accept','order.read','receipt.confirm','conversation.shared.read',
  'conversation.shared.post','shared_catalog.read','attachment.upload','attachment.delete_own','organization.read']);

-- Unidades globales (OD-18)
insert into units_of_measure (organization_id, code, name) values
  (null,'PZA','Pieza'), (null,'KG','Kilogramo'), (null,'G','Gramo'), (null,'L','Litro'), (null,'ML','Mililitro'),
  (null,'M','Metro'), (null,'CM','Centímetro'), (null,'M2','Metro cuadrado'), (null,'M3','Metro cúbico'),
  (null,'CAJA','Caja'), (null,'PAQ','Paquete'), (null,'JUEGO','Juego'), (null,'HR','Hora'), (null,'DIA','Día'),
  (null,'SERV','Servicio'), (null,'VIAJE','Viaje');

-- =============================================================================
-- 15. Bootstrap de organización: settings + roles base + admin principal
-- =============================================================================

create or replace function app.bootstrap_organization() returns trigger
language plpgsql as $$
declare r record; v_role_id uuid; v_membership_id uuid;
begin
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

create trigger organizations_bootstrap after insert on organizations
  for each row execute function app.bootstrap_organization();

-- =============================================================================
-- 16. Roles de base de datos y grants (OD-36)
-- =============================================================================
-- El backend conecta como procura_app (RLS aplica). service_role (BYPASSRLS) queda para
-- migraciones y jobs cross-org (dispatcher de Inngest). anon/authenticated no ven nada.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'procura_app') then
    create role procura_app login nobypassrls;        -- ⚠ fijar contraseña: alter role procura_app password '…';
  end if;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant usage on schema public, app to procura_app;
grant select, insert, update, delete on all tables in schema public to procura_app;
grant usage, select on all sequences in schema public to procura_app;
grant execute on all functions in schema app to procura_app;
alter default privileges in schema public grant select, insert, update, delete on tables to procura_app;
alter default privileges in schema public grant usage, select on sequences to procura_app;

-- Append-only
revoke update, delete on audit_logs from procura_app;
revoke update, delete on permissions, role_templates from procura_app;

-- =============================================================================
-- 17. Row-Level Security
-- =============================================================================

do $$
declare t text;
begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Global de solo lectura
create policy p_permissions on permissions for select to procura_app using (true);
create policy p_role_templates on role_templates for select to procura_app using (true);

-- Usuarios: el backend puede leer perfiles (resuelve nombres); solo el propio usuario se edita
create policy p_users_select on users for select to procura_app using (true);
create policy p_users_insert on users for insert to procura_app with check (id = app.current_user_id());
create policy p_users_update on users for update to procura_app using (id = app.current_user_id());

-- Organizaciones: la propia con todo; el resto solo lectura (búsqueda, contraparte de relaciones)
create policy p_orgs_select on organizations for select to procura_app using (true);
create policy p_orgs_insert on organizations for insert to procura_app with check (created_by_user_id = app.current_user_id());
create policy p_orgs_update on organizations for update to procura_app using (id = app.current_org());

-- Memberships: las de la org activa, o las del usuario actual (para elegir organización antes de fijar contexto)
create policy p_memberships on memberships for all to procura_app
  using (organization_id = app.current_org() or user_id = app.current_user_id())
  with check (organization_id = app.current_org() or user_id = app.current_user_id());

-- Unidades: globales + propias
create policy p_units on units_of_measure for all to procura_app
  using (organization_id is null or organization_id = app.current_org())
  with check (organization_id = app.current_org());

-- INTERNAL: organization_id = org activa
do $$
declare t text;
begin
  foreach t in array array[
    'organization_settings','organization_sequences','departments','locations','roles','role_permissions',
    'role_assignments','invitations','invitation_roles','api_keys','api_key_roles','categories','catalog_items',
    'catalog_imports','catalog_import_rows','requisitions','requisition_concepts','requisition_templates',
    'approval_workflows','approval_rules','approval_requests','approval_steps','approval_decisions',
    'quotation_supplier_private','order_party_private','notifications','webhook_endpoints','webhook_deliveries',
    'idempotency_keys','domain_events'
  ] loop
    execute format('create policy p_internal on public.%I for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org())', t);
  end loop;
end $$;

-- SHARED: org activa es comprador o proveedor
do $$
declare t text;
begin
  foreach t in array array[
    'relationships','relationship_terms','relationship_contacts','catalog_shares',
    'quotation_requests','quotation_request_lines','quotations','quotation_lines',
    'orders','order_lines','deliveries','delivery_lines','receipts','receipt_lines'
  ] loop
    execute format('create policy p_shared on public.%I for all to procura_app using (app.current_org() in (buyer_organization_id, supplier_organization_id)) with check (app.current_org() in (buyer_organization_id, supplier_organization_id))', t);
  end loop;
end $$;

-- Mixtas (INTERNAL o SHARED según visibility)
create policy p_threads on threads for all to procura_app
  using ((visibility = 'INTERNAL' and organization_id = app.current_org()) or (visibility = 'SHARED' and app.current_org() in (buyer_organization_id, supplier_organization_id)))
  with check ((visibility = 'INTERNAL' and organization_id = app.current_org()) or (visibility = 'SHARED' and app.current_org() in (buyer_organization_id, supplier_organization_id)));

create policy p_messages on messages for all to procura_app
  using ((visibility = 'INTERNAL' and organization_id = app.current_org()) or (visibility = 'SHARED' and app.current_org() in (buyer_organization_id, supplier_organization_id)))
  with check (author_organization_id = app.current_org());

create policy p_attachments on attachments for all to procura_app
  using (owner_organization_id = app.current_org() or (visibility = 'SHARED' and app.current_org() in (buyer_organization_id, supplier_organization_id)))
  with check (owner_organization_id = app.current_org());

-- Auditoría: visible para las organizaciones listadas; inserción solo desde el contexto propio
create policy p_audit_select on audit_logs for select to procura_app using (app.current_org() = any (visible_to_organization_ids));
create policy p_audit_insert on audit_logs for insert to procura_app with check (organization_id = app.current_org());

commit;
