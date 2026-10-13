-- Ventas importadas de un punto de venta: llave externa para no duplicar al reimportar el mismo archivo (el folio del ticket, o una huella de fecha+importe).
alter table sales add column if not exists external_ref text;
create unique index if not exists sales_external_uq on sales (organization_id, external_ref) where external_ref is not null;
