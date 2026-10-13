-- Cobro con Stripe: plan por organización, créditos de timbrado (libro de movimientos) y control de eventos del webhook.
create table if not exists organization_subscriptions (
  organization_id        uuid primary key references organizations(id) on delete cascade,
  plan                   text check (plan in ('esencial', 'control', 'negocio')),
  status                 text not null default 'NONE' check (status in ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE')),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  grace_until            timestamptz,                          -- tras un pago fallido: hasta cuándo se conserva el plan
  credits_required       boolean not null default false,       -- true: cada timbrado consume un crédito (se enciende al comprar el primer paquete)
  updated_at             timestamptz not null default now()
);
-- Libro de créditos de timbrado: solo se agregan filas. Saldo = suma de `delta`. La llave (organización, tipo, referencia) hace idempotente cada compra y cada consumo.
create table if not exists stamp_credit_ledger (
  id               uuid primary key default app.uuid_v7(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  delta            int not null check (delta <> 0),
  kind             text not null check (kind in ('PURCHASE', 'CONSUME', 'ADJUST')),
  reference        text not null,                              -- sesión de pago de Stripe, o la solicitud de emisión que consumió el crédito
  note             text,
  created_at       timestamptz not null default now(),
  unique (organization_id, kind, reference)
);
create index if not exists stamp_credit_ledger_org_idx on stamp_credit_ledger (organization_id, created_at desc);
do $$ declare t text; begin foreach t in array array['organization_subscriptions','stamp_credit_ledger'] loop
  execute format('alter table %I enable row level security; alter table %I force row level security;', t, t);
  execute format('drop policy if exists p_internal on %I', t);
  execute format('create policy p_internal on %I for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org())', t);
end loop; end $$;
grant select, insert, update on organization_subscriptions to procura_app;
grant select, insert on stamp_credit_ledger to procura_app;   -- nunca se edita ni se borra un movimiento

-- Webhook de Stripe (sin sesión ni organización): cada evento se procesa una sola vez, y el cliente de Stripe se resuelve a su organización.
create table if not exists stripe_events (id text primary key, type text not null, received_at timestamptz not null default now());
revoke all on stripe_events from public;
create or replace function app.stripe_event_claim(p_id text, p_type text) returns boolean
language sql security definer set search_path = public as $$ with i as (insert into stripe_events (id, type) values (p_id, p_type) on conflict do nothing returning 1) select exists (select 1 from i) $$;
create or replace function app.stripe_event_release(p_id text) returns void
language sql security definer set search_path = public as $$ delete from stripe_events where id = p_id $$;
create or replace function app.org_by_stripe_customer(p_customer text) returns uuid
language sql security definer stable set search_path = public as $$ select organization_id from organization_subscriptions where stripe_customer_id = p_customer $$;
revoke all on function app.stripe_event_claim(text, text), app.stripe_event_release(text), app.org_by_stripe_customer(text) from public;
grant execute on function app.stripe_event_claim(text, text), app.stripe_event_release(text), app.org_by_stripe_customer(text) to procura_app;
