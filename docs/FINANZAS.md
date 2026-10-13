# Módulo financiero: ventas, cobros/pagos, CFDI y gastos

Alcance de esta fase: **registrar y vincular**. No hay contabilidad fiscal, ni pólizas, ni conexión bancaria, ni emisión real de CFDI (ver «Qué no hace»).

## Modelo (migraciones `20261012…` y `20261013…`)

| Tabla | Para qué |
|---|---|
| `sales`, `sale_lines`, `customers` | Ventas con conceptos, descuento, IVA desglosado por línea, método de pago y cliente opcional. Folio `VTA-00001` por organización. |
| `payments` | Cobros (`IN`, de una venta) y pagos (`OUT`, de un gasto), parciales y anulables. Un pago nunca excede el pendiente. |
| `cfdi_documents` | **Única fuente de verdad del dato fiscal** por organización (emitidos y recibidos). UUID único por organización, XML/PDF en Storage privado, `source` (carga manual, factura de proveedor en una orden, sincronización, emitido), vigencia SAT conocida, `provider`/`provider_external_id`, `last_synced_at`. |
| `cfdi_links` | Liga un CFDI con **una venta o un gasto** (exactamente uno) con el importe que documenta. Un CFDI puede amparar varias operaciones y una operación varios CFDI; no hay duplicados por par. Reemplaza a `expense_invoices` (migrada, sin uso). |
| `supplier_invoices` | Sigue siendo el flujo de revisión de la factura que un proveedor adjunta a una orden (valida contra orden y recepción). Apunta a su CFDI recibido (`buyer_cfdi_id`) y emitido (`supplier_cfdi_id`); no duplica el dato fiscal. |
| `fiscal_provider_connections` | Estado de la conexión con un proveedor fiscal por organización. **Sin secretos.** |
| `expenses` | Ya existía; ahora `paid_minor` y `documented_minor` (caché). |

### Estados: se derivan, no se capturan
- **Cobro/pago**: `PENDING` · `PARTIAL` · `COLLECTED` (o `VOIDED`) según lo cobrado/pagado.
- **Facturación**: `NONE` · `PENDING` · `PARTIAL` · `INVOICED` · `INCIDENT` según lo documentado con CFDI. Solo «pendiente» e «incidencia» son marcas manuales (`invoicing_flag`).
- Son independientes: una factura emitida no cambia el cobro y un cobro no cambia la facturación. Las columnas `collected_minor`, `paid_minor`, `documented_minor`, `allocated_minor` son caché que se recalcula en la misma transacción (`src/lib/finance/ops.ts`).
- Reglas al ligar: moneda igual, solo CFDI de **ingreso** y no cancelado, ventas con CFDI **emitidos** y gastos con **recibidos**, importe ≤ lo que falta en la operación y ≤ lo que le queda al CFDI (tolerancia $1). Desligar exige motivo y queda en auditoría.
- Anular no borra: venta/gasto con cobros/pagos vigentes o CFDI ligados no se anula hasta revertirlos.

## API
Ver `docs/API.md` §«Finanzas». Todas las rutas toman la organización activa de la sesión o de la llave de API (nunca un id del cliente), RLS fuerza el aislamiento y las escrituras sensibles se auditan (`sale.*`, `payment.*`, `cfdi.*`, `expense.*`).

Permisos nuevos: `sale.read`, `sale.manage`, `payment.manage`, `cfdi.read`, `cfdi.manage`, `finance.read` (más `invoice.*` y `expense.*` de la fase anterior). Reciben los de finanzas: Administrador y Finanzas todos; Compras y Proveedor solo `cfdi.read`.

## Integración fiscal (Fiscalapi): solo la estructura
`src/lib/fiscal/provider.ts` define la interfaz (`issueCfdi`, `listCfdi`, `getCfdiStatus`, capacidades, errores tipificados, reintento con espera exponencial solo para errores transitorios) y `src/lib/fiscal/fiscalapi.ts` es el adaptador.

**Verificado en docs.fiscalapi.com:** autenticación con `X-API-KEY` y `X-TENANT-KEY` (más `X-TIME-ZONE`); URLs `https://test.fiscalapi.com` (pruebas) y `https://live.fiscalapi.com` (producción); ruta `/api/v4`; listado `GET /api/v4/invoices?pageNumber=&pageSize=`; la factura de ingreso por referencia pide `typeCode`, `series`, `date`, `currencyCode`, `expeditionZipCode`, `paymentFormCode`, `paymentMethodCode`, `issuer`, `recipient` e `items` con `itemTaxes`; el PDF y el XML llegan en base64. **Sin verificar:** las rutas exactas de crear, obtener, cancelar, estado, PDF y XML, y la estructura de emisores y certificados (`/issuers`, `/tax-files`). Por eso solo está implementada la **prueba de conexión** (lectura del listado) y todas las capacidades de emisión y recuperación siguen en `false`. Sin `FISCALAPI_URL` se usa el ambiente de pruebas. La UI (Facturas y Administración → Organización) y `GET /fiscal/provider` muestran el estado real; `POST /fiscal/sync` responde `501`. Variables reservadas (opcionales, solo servidor): `FISCALAPI_API_KEY`, `FISCALAPI_TENANT`, `FISCALAPI_URL`.

Cuando se verifique el contrato: implementar cada método del adaptador, declarar su capacidad, y mantener **separados** los flujos de emisión y de recuperación. Cada empresa deberá autorizar el acceso a su información fiscal; las credenciales de una no sirven para otra.

## Qué no hace
- No emite CFDI ni los timbra; no sincroniza con el SAT ni con un PAC; no consulta vigencia (`sat_status` queda `UNKNOWN` salvo que se registre).
- No genera pólizas ni lleva catálogo contable. Lo que el resumen (`GET /finance/summary`) muestra **no es utilidad fiscal, declaración de impuestos ni contabilidad definitiva**.
- No concilia con bancos.

## Preparación para pólizas (fase siguiente)
Se evitó lo que lo dificultaría: todo registro lleva organización, fecha, moneda, referencia a su origen y auditoría; los importes son enteros en unidades menores; cobros/pagos son movimientos separados de la operación y del CFDI (una póliza de ingreso/egreso debe nacer de cobros y pagos, no de cada CFDI); los impuestos van desglosados por línea. Falta: catálogo de cuentas, periodos contables, reglas de contabilización configurables, asientos balanceados y exportación.

## Pruebas
- `npm test` — pruebas unitarias (Vitest) de cálculo de ventas e impuestos, estados, asignación de importes, lectura/validación de CFDI, capa fiscal y reintentos.
- `npm run test:integration` — recorrido completo contra un servidor en marcha (requiere `.env.local`; **escribe y luego retira datos** en la base configurada): ventas, cobros parciales, CFDI (duplicados, parcial, varias operaciones), gastos, resumen, aislamiento entre organizaciones, permisos y estado del proveedor fiscal.
