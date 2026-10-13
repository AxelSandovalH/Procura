-- La referencia del documento (comercio + folio) debe ser única solo entre gastos vigentes: un gasto anulado no impide volver a registrarlo.
drop index if exists expenses_external_uq;
create unique index if not exists expenses_external_uq on expenses (organization_id, external_reference) where external_reference is not null and voided_at is null;
