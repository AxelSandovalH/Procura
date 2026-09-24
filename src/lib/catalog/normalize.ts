export interface RowMessage { field: string; level: "WARNING" | "ERROR"; message: string }

export interface NormalizedRow {
  sku: string | null;
  name: string | null;
  description: string | null;
  item_type: "GOOD" | "SERVICE";
  unit_label: string | null;
  unit_id: string | null;
  list_price_minor: number | null;
  currency: string | null;
  category_id: string | null;
  is_active: boolean;
}

export interface ColumnMapping {
  sku: string; name: string;
  description?: string; item_type?: string; unit?: string; price?: string; category?: string; is_active?: string;
}

const ACTIVE_TRUE = new Set(["true", "1", "si", "sí", "activo", "yes", "y"]);
const ACTIVE_FALSE = new Set(["false", "0", "no", "inactivo", "n"]);
const TYPE_SERVICE = new Set(["service", "servicio", "srv"]);
const TYPE_GOOD = new Set(["good", "bien", "producto", "goods"]);

/** Convierte una fila cruda (según el mapeo elegido) en campos tipados + mensajes de validación. */
export function normalizeRow(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  lookups: { unitByCode: Map<string, string>; categoryByName: Map<string, string> },
): { normalized: NormalizedRow; messages: RowMessage[] } {
  const messages: RowMessage[] = [];
  const get = (col?: string) => (col ? (raw[col] ?? "").trim() : "");

  const sku = get(mapping.sku);
  if (!sku) messages.push({ field: "sku", level: "ERROR", message: "SKU vacío o columna no mapeada" });

  const name = get(mapping.name);
  if (!name) messages.push({ field: "name", level: "ERROR", message: "Nombre vacío o columna no mapeada" });

  const description = get(mapping.description) || null;

  const rawType = get(mapping.item_type).toLowerCase();
  let item_type: "GOOD" | "SERVICE" = "GOOD";
  if (rawType) {
    if (TYPE_SERVICE.has(rawType)) item_type = "SERVICE";
    else if (TYPE_GOOD.has(rawType)) item_type = "GOOD";
    else messages.push({ field: "item_type", level: "WARNING", message: `Tipo "${rawType}" no reconocido, se usará GOOD` });
  }

  const rawUnit = get(mapping.unit);
  let unit_id: string | null = null;
  let unit_label: string | null = rawUnit || null;
  if (rawUnit) {
    const match = lookups.unitByCode.get(rawUnit.toLowerCase());
    if (match) unit_id = match;
    else messages.push({ field: "unit", level: "WARNING", message: `Unidad "${rawUnit}" no está en el catálogo de unidades, se guardará como texto libre` });
  }

  const rawPrice = get(mapping.price);
  let list_price_minor: number | null = null;
  if (rawPrice) {
    const cleaned = rawPrice.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const value = Number(cleaned);
    if (Number.isFinite(value) && value >= 0) list_price_minor = Math.round(value * 100);
    else messages.push({ field: "price", level: "WARNING", message: `Precio "${rawPrice}" no es un número válido, se omitirá` });
  }

  const rawCategory = get(mapping.category);
  let category_id: string | null = null;
  if (rawCategory) {
    const match = lookups.categoryByName.get(rawCategory.toLowerCase());
    if (match) category_id = match;
    else messages.push({ field: "category", level: "WARNING", message: `Categoría "${rawCategory}" no existe, se dejará sin categoría` });
  }

  const rawActive = get(mapping.is_active).toLowerCase();
  let is_active = true;
  if (rawActive) {
    if (ACTIVE_TRUE.has(rawActive)) is_active = true;
    else if (ACTIVE_FALSE.has(rawActive)) is_active = false;
    else messages.push({ field: "is_active", level: "WARNING", message: `Valor "${rawActive}" no reconocido, se usará activo=true` });
  }

  return {
    normalized: { sku: sku || null, name: name || null, description, item_type, unit_label, unit_id, list_price_minor, currency: list_price_minor != null ? "MXN" : null, category_id, is_active },
    messages,
  };
}

export function rowLevel(messages: RowMessage[]): "OK" | "WARNING" | "ERROR" {
  if (messages.some((m) => m.level === "ERROR")) return "ERROR";
  if (messages.length > 0) return "WARNING";
  return "OK";
}
