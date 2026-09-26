-- Cuando el PROVEEDOR rechaza o cancela una orden, la requisición (INTERNAL del comprador) debe
-- volver a SENT — pero el contexto de transacción en ese momento es el del proveedor, y RLS
-- bloquea el UPDATE cross-org (0 filas afectadas → Prisma P2025). Esta función valida que el
-- requisition_id corresponda de verdad a una orden del actor que la invoca antes de tocarlo.
create or replace function app.reopen_requisition_after_order_setback(p_order_id uuid, p_acting_org uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_requisition_id uuid;
begin
  select requisition_id into v_requisition_id
  from orders
  where id = p_order_id and (buyer_organization_id = p_acting_org or supplier_organization_id = p_acting_org);

  if v_requisition_id is null then
    raise exception 'order_not_found_for_org' using errcode = 'P0001';
  end if;

  update requisitions set status = 'SENT', order_id = null where id = v_requisition_id;
end $$;

revoke all on function app.reopen_requisition_after_order_setback(uuid, uuid) from public;
grant execute on function app.reopen_requisition_after_order_setback(uuid, uuid) to procura_app;
