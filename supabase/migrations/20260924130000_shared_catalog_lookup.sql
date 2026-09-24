-- El catálogo compartido cruza organizaciones a propósito: el comprador debe poder leer ítems
-- del proveedor, pero catalog_items es INTERNAL (RLS = organization_id = app.current_org()).
-- Esta función valida la relación y el share DENTRO de la función (no confía en el caller) y
-- solo entonces expone las columnas necesarias del catálogo del proveedor.
create or replace function app.shared_catalog_items(
  p_relationship_id uuid,
  p_requesting_org uuid,
  p_category_id uuid default null,
  p_query text default null
)
returns table (
  id uuid, sku text, name text, description text, item_type item_type,
  unit_label text, category_id uuid, list_price_minor bigint, currency char(3)
)
language sql security definer stable
set search_path = public
as $$
  with rel as (
    select r.supplier_organization_id
    from relationships r
    where r.id = p_relationship_id
      and r.buyer_organization_id = p_requesting_org
      and r.status = 'ACTIVE'
  ),
  shares as (
    select cs.catalog_item_id, cs.category_id, cs.show_price
    from catalog_shares cs, rel
    where cs.relationship_id = p_relationship_id and cs.is_active = true
  )
  select ci.id, ci.sku, ci.name, ci.description, ci.item_type, ci.unit_label, ci.category_id,
         case when coalesce(item_share.show_price, cat_share.show_price, false) then ci.list_price_minor else null end,
         case when coalesce(item_share.show_price, cat_share.show_price, false) then ci.currency else null end
  from rel
  join catalog_items ci on ci.organization_id = rel.supplier_organization_id and ci.is_active = true
  left join shares item_share on item_share.catalog_item_id = ci.id
  left join shares cat_share on cat_share.category_id = ci.category_id
  where (item_share.catalog_item_id is not null or cat_share.category_id is not null)
    and (p_category_id is null or ci.category_id = p_category_id)
    and (p_query is null or ci.sku ilike '%' || p_query || '%' or ci.name ilike '%' || p_query || '%')
  limit 200
$$;

revoke all on function app.shared_catalog_items(uuid, uuid, uuid, text) from public;
grant execute on function app.shared_catalog_items(uuid, uuid, uuid, text) to procura_app;
