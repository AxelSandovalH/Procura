-- Folio fiscal (UUID) leído de la factura en PDF cuando aún no hay XML: al llegar el CFDI (descarga del SAT o carga manual) se liga solo.
alter table expenses add column if not exists cfdi_uuid_hint text;
create index if not exists expenses_cfdi_uuid_hint_idx on expenses (organization_id, cfdi_uuid_hint) where cfdi_uuid_hint is not null;
