-- Bitácora de notas por gasto: solo se agregan (no se editan ni se borran) para conservar la trazabilidad con fecha y autor.
create table if not exists expense_notes (
  id                    uuid primary key default app.uuid_v7(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  expense_id            uuid not null references expenses(id) on delete cascade,
  body                  text not null check (length(btrim(body)) between 1 and 2000),
  author_membership_id  uuid references memberships(id),
  author_name           text not null,
  created_at            timestamptz not null default now()
);
create index if not exists expense_notes_expense_idx on expense_notes (expense_id, created_at);
alter table expense_notes enable row level security; alter table expense_notes force row level security;
drop policy if exists p_internal on expense_notes;
create policy p_internal on expense_notes for all to procura_app using (organization_id = app.current_org()) with check (organization_id = app.current_org());
grant select, insert on expense_notes to procura_app;
