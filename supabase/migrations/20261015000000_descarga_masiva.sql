-- Descarga masiva de CFDI (SAT vía proveedor fiscal): registro de qué solicitudes ya se importaron, para no repetir ni perder ninguna.
create table if not exists fiscal_sync_imports (
  id                  uuid primary key default app.uuid_v7(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  provider            text not null,
  provider_request_id text not null,
  provider_rule_id    text,
  direction           cfdi_direction not null,
  status              text not null check (status in ('RUNNING', 'IMPORTED', 'PARTIAL', 'FAILED')),
  created_count       integer not null default 0,
  duplicate_count     integer not null default 0,
  error_count         integer not null default 0,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, provider, provider_request_id)
);
alter table fiscal_sync_imports enable row level security; alter table fiscal_sync_imports force row level security;
drop policy if exists p_internal on fiscal_sync_imports;
create policy p_internal on fiscal_sync_imports for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
grant select, insert, update, delete on fiscal_sync_imports to procura_app;
