-- Aprobar DESPUÉS de cotizar (configurable por organización).
--  * BEFORE_QUOTING (comportamiento histórico): requisición → aprobación → cotizaciones → orden.
--  * AFTER_QUOTING: requisición → cotizaciones → se elige una → aprobación de esa compra → orden.
-- SUBMITTED = requisición enviada y lista para cotizar, aún sin aprobar (solo en AFTER_QUOTING).
alter type requisition_status add value if not exists 'SUBMITTED' after 'PENDING_APPROVAL';

do $$ begin
  create type approval_timing as enum ('BEFORE_QUOTING', 'AFTER_QUOTING');
exception when duplicate_object then null; end $$;

alter table organization_settings add column if not exists approval_timing approval_timing not null default 'AFTER_QUOTING';
-- Las organizaciones existentes conservan su flujo actual; las nuevas arrancan en AFTER_QUOTING.
update organization_settings set approval_timing = 'BEFORE_QUOTING';

-- La aprobación de una compra apunta a la cotización elegida (null = aprobación de la requisición, flujo histórico).
alter table approval_requests add column if not exists quotation_id uuid references quotations(id) on delete set null;
create index if not exists approval_requests_quotation_idx on approval_requests (quotation_id) where quotation_id is not null;
