-- La cancelación ante el SAT no es inmediata: el CFDI pasa por «CANCELANDO» antes de «CANCELADO» (o de volver a «VIGENTE»).
alter table cfdi_documents drop constraint if exists cfdi_documents_sat_status_check;
alter table cfdi_documents add constraint cfdi_documents_sat_status_check check (sat_status in ('UNKNOWN','VIGENTE','CANCELANDO','CANCELADO'));
