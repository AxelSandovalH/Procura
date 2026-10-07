-- El rol base «Aprobador» no veía las cotizaciones ni las órdenes: aprobaba sin poder ver qué compra se le pedía aprobar.
-- Solo cambia la plantilla (organizaciones NUEVAS); los roles ya creados no se tocan.
insert into role_templates (name, description, permission_code) values
  ('Aprobador', 'Aprueba requisiciones dentro de su scope', 'quotation.read'),
  ('Aprobador', 'Aprueba requisiciones dentro de su scope', 'order.read')
on conflict do nothing;
