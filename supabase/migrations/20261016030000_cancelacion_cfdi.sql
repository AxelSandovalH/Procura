-- Cancelación de CFDI emitidos: quién la pidió, con qué motivo y cuándo se confirmó ante el SAT.
alter table cfdi_documents
  add column if not exists cancel_reason_code text check (cancel_reason_code is null or cancel_reason_code in ('01','02','03')),
  add column if not exists cancel_replacement_uuid text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by uuid references memberships(id),
  add column if not exists cancelled_at timestamptz;

-- Organizaciones con una cancelación en proceso, para consultarla periódicamente (corre sin contexto de organización).
create or replace function app.orgs_with_cancelling_cfdi()
returns table (organization_id uuid)
language sql security definer
set search_path = public
as $$ select distinct d.organization_id from cfdi_documents d where d.sat_status = 'CANCELANDO' and d.provider_external_id is not null $$;
grant execute on function app.orgs_with_cancelling_cfdi() to procura_app;
