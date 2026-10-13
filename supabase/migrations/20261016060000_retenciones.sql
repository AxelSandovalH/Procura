-- Retenciones de impuestos (p. ej. RESICO: ISR 1.25% e IVA 2/3 cuando el cliente es persona moral).
-- Un CFDI con retenciones tiene un total NETO menor a lo que documenta: documenta subtotal + IVA trasladado; el cliente retiene el resto y lo entera al SAT.
alter table cfdi_documents add column if not exists retained_minor bigint not null default 0 check (retained_minor >= 0);
-- Parte de la venta que el cliente no paga porque la retiene (se calcula de los CFDI ligados): lo que se cobra es total − retenido.
alter table sales add column if not exists withheld_minor bigint not null default 0 check (withheld_minor >= 0);
