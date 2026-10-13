-- Regla por organización: un gasto con XML (CFDI) ligado se considera pagado por lo documentado. Apagada por omisión.
alter table organization_settings add column if not exists expenses_paid_when_xml boolean not null default false;
