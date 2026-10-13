-- Conciliación bancaria (importación manual): cuentas, movimientos importados y su vínculo con pagos/cobros.
create table if not exists bank_accounts (
  id               uuid primary key default app.uuid_v7(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  bank             text,
  currency         char(3) not null default 'MXN',
  last4            text check (last4 is null or last4 ~ '^\d{4}$'),   -- solo los últimos 4 dígitos, nunca el número completo
  archived_at      timestamptz,
  created_at       timestamptz not null default now()
);
create table if not exists bank_transactions (
  id               uuid primary key default app.uuid_v7(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  bank_account_id  uuid not null references bank_accounts(id) on delete cascade,
  posted_at        date not null,
  description      text not null,
  amount_minor     bigint not null,                  -- con signo: negativo = cargo (salida), positivo = abono (entrada)
  balance_minor    bigint,
  reference        text,
  dedupe_key       text not null,
  status           text not null default 'UNMATCHED' check (status in ('UNMATCHED','MATCHED','IGNORED')),
  payment_id       uuid references payments(id),
  matched_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (bank_account_id, dedupe_key)
);
create unique index if not exists bank_transactions_payment_uq on bank_transactions (payment_id) where payment_id is not null;
create index if not exists bank_transactions_list_idx on bank_transactions (organization_id, bank_account_id, status, posted_at desc);
do $$ declare t text; begin foreach t in array array['bank_accounts','bank_transactions'] loop
  execute format('alter table %I enable row level security; alter table %I force row level security;', t, t);
  execute format('drop policy if exists p_internal on %I', t);
  execute format('create policy p_internal on %I for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org())', t);
  execute format('grant select, insert, update, delete on %I to procura_app', t);
end loop; end $$;
