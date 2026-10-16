-- Sustituir un CFDI de una venta: la emisión anterior queda marcada como reemplazada y deja de ocupar el único lugar «vivo» de la venta.
alter table fiscal_issue_requests add column if not exists replaced_at timestamptz;
drop index if exists fiscal_issue_one_live_uq;
create unique index fiscal_issue_one_live_uq on fiscal_issue_requests (sale_id) where (status = 'PENDING' or (status = 'DONE' and replaced_at is null));
