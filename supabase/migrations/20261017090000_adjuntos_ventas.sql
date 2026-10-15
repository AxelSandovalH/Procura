-- Comprobantes (tickets de depósito, recibos) adjuntos a una venta.
alter type attachment_anchor_type add value if not exists 'SALE';
