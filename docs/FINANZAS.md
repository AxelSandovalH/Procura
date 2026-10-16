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

## Gastos desde la foto de un ticket
`Gastos → Escanear ticket`: la foto se reduce y convierte a JPEG en el navegador, `POST /expenses/scan` la lee con Claude (`claude-opus-5-5`, salida estructurada validada con zod, esfuerzo bajo) y devuelve un **borrador** (fecha, total, comercio, RFC si está impreso, categoría sugerida, confianza y avisos). La persona lo revisa y lo confirma; solo entonces se crea el gasto y se guarda la foto como evidencia. Reglas: el contenido de la imagen se trata como dato (no como instrucciones), la fecha futura o inválida se descarta, un total ilegible no se inventa, y se avisa si ya existe un gasto con la misma fecha e importe. Costo aproximado: centavos de dólar por ticket. La imagen se envía al servicio de Claude solo para extraer los datos. Variable: `ANTHROPIC_API_KEY` (solo servidor).

## Descarga masiva del SAT (Fiscalapi)
Verificado en `docs.fiscalapi.com` (`/download-info`, `/download-rules`, `/download-requests`): requiere el módulo de descarga masiva y la **e.firma** (no el CSD) cargada en el proveedor; se crean **reglas** (CFDI emitidos y recibidos vigentes), el proveedor genera **solicitudes** (una automática diaria; por API solo manuales, máximo 31 días por solicitud) y los XML listos se leen con `GET /api/v4/download-requests/{id}/xmls` (`base64Content`).
Procura: `POST /fiscal/downloads/rules` (activa y crea las reglas que falten), `GET /fiscal/downloads` (estado), `POST /fiscal/sync` (con `from`/`to` pide periodos en ventanas de 30 días; siempre importa lo listo) y el cron horario `/api/cron/fiscal-sync`. Es idempotente (folio fiscal único por organización + registro de solicitudes importadas en `fiscal_sync_imports`). **Sin verificar:** parámetros de paginación de `/xmls` (se usa `pageNumber`/`pageSize` y se corta si el proveedor los ignora), valores de estado de reglas y solicitudes (se muestran tal cual), costo y plan.

## Qué no hace
- **Cancelación** (solo CFDI emitidos desde Procura, con el proveedor actual): `POST /api/v1/cfdi/{id}/cancel {reason_code: 01|02|03, replacement_uuid (con 01), confirm: true}`. Llama a `DELETE /api/v4/invoices` de Fiscalapi (verificado en su documentación; firma con el CSD del emisor). No es inmediata: el CFDI queda `CANCELANDO` hasta que el SAT confirma (`CANCELADO`) o el receptor rechaza (vuelve a `VIGENTE`); `POST /cfdi/{id}/refresh-status` consulta el estado y el cron horario revisa las cancelaciones pendientes. El motivo 01 exige un CFDI emitido y vigente de la propia organización como sustituto; el 04 (factura global) no se admite. Al confirmarse, las ventas ligadas recalculan su importe documentado (el vínculo se conserva como historial). Solo aplica a facturas emitidas **por referencias** (así las emite Procura); si Fiscalapi responde que se generó por valores, el error se muestra tal cual. Requiere permiso `cfdi.manage` y queda en auditoría (`cfdi.cancellation_requested`, `cfdi.cancelled`, `cfdi.cancellation_rejected`). Cancelar en producción es un trámite fiscal real.
- El PDF de un CFDI emitido desde Procura se genera una vez (`POST /api/v1/cfdi/{id}/pdf`, botón «Generar PDF» en el detalle) y se guarda; no existe para los CFDI cargados a mano o recibidos. No consulta vigencia de uno cargado a mano (`sat_status` queda `UNKNOWN`; los traídos por descarga masiva y los emitidos desde Procura se marcan vigentes al recibirlos).
- No genera pólizas ni lleva catálogo contable. Lo que el resumen (`GET /finance/summary`) muestra **no es utilidad fiscal, declaración de impuestos ni contabilidad definitiva**.
- No concilia con bancos.

## Preparación para pólizas (fase siguiente)
Se evitó lo que lo dificultaría: todo registro lleva organización, fecha, moneda, referencia a su origen y auditoría; los importes son enteros en unidades menores; cobros/pagos son movimientos separados de la operación y del CFDI (una póliza de ingreso/egreso debe nacer de cobros y pagos, no de cada CFDI); los impuestos van desglosados por línea. Falta: catálogo de cuentas, periodos contables, reglas de contabilización configurables, asientos balanceados y exportación.

## Pruebas
- `npm test` — pruebas unitarias (Vitest) de cálculo de ventas e impuestos, estados, asignación de importes, lectura/validación de CFDI, capa fiscal y reintentos.
- `npm run test:integration` — recorrido completo contra un servidor en marcha (requiere `.env.local`; **escribe y luego retira datos** en la base configurada): ventas, cobros parciales, CFDI (duplicados, parcial, varias operaciones), gastos, resumen, aislamiento entre organizaciones, permisos y estado del proveedor fiscal.

## Portal de autofacturación (público, sin sesión)

El cliente final pide su CFDI en `/{slug}/facturar` con el **folio y el total exactos** de su ticket (la venta debe existir en Procura: a mano o por la API desde el punto de venta).

- **Configuración** (Administración → Organización → «Portal de autofacturación», permiso `organization.update`): activar, plazo en días desde la venta, tope diario de facturas pedidas por el público, forma de pago por omisión y texto de bienvenida. Para encenderlo hace falta el emisor fiscal y la clave de producto/unidad SAT por omisión (el cliente no las captura). Cada factura consume un timbre de la organización.
- **API pública** (`/api/v1/portal/{slug}/autoinvoice`): `GET` (datos mínimos del portal), `POST /lookup {folio, total}` y `POST /issue {folio, total, payment_form_code, recipient{tax_id, legal_name, tax_regime_code, zip_code, cfdi_use_code, email}, accept: true}`. Un folio o total incorrecto responde siempre lo mismo (no se pueden adivinar folios).
- **Candados**: límite por IP (búsqueda 20/10 min, emisión 12/h), límite por organización, plazo, tope diario, una sola emisión por venta (el mismo bloqueo de la emisión interna) y captcha opcional (Cloudflare Turnstile: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`; sin ellas no se pide).
- **Una sola ruta de emisión**: `src/lib/billing/issue-sale.ts` la comparten la app y el portal. Cada intento queda en `fiscal_issue_requests` con `source = PORTAL`, el correo y un hash de la IP.
- **Errores seguros**: al cliente nunca se le muestran saldos, credenciales ni detalles del proveedor fiscal; ve un mensaje genérico.
- **Entrega**: el XML se envía al correo del cliente (adjunto) y hay un enlace de descarga de 15 minutos. El **PDF** se genera con el proveedor al emitir (`POST /api/v4/invoices/pdf`, verificado en su documentación), se guarda junto al XML y se adjunta al correo y al enlace; si el proveedor no responde, la factura igual se entrega con el XML y el PDF se puede generar después.

## Retenciones (RESICO y similares)

Una factura de una persona física en RESICO a una **persona moral** suele llevar retenciones: **ISR 1.25%** e **IVA 2/3 (10.6667%)** en servicios personales independientes. El cliente las retiene y las entera al SAT, así que el **total del CFDI es neto** (subtotal + IVA − retenciones) y menor al de la venta.

- **Lectura**: `cfdi_documents.retained_minor` sale de `TotalImpuestosRetenidos` del XML. Un CFDI **documenta** hasta `total + retenido` (subtotal + IVA trasladado), por eso liga a la venta completa y la deja «facturada» en vez de «parcial».
- **Cobro**: `sales.withheld_minor` (calculado de los CFDI ligados vigentes) es lo que el cliente no paga: lo que el vínculo documenta **por encima del total neto** del CFDI, hasta lo retenido. Si la venta se registra en bruto (subtotal + IVA), se descuenta todo lo retenido; si se registra por lo que de verdad se cobra (≈ el neto), no se resta nada más. Se cobra `total − retenido`: el estado de cobro, el tope de cobro, lo «por cobrar» del resumen y las sugerencias de conciliación bancaria ya lo descuentan. Si el CFDI se cancela, deja de contar.
- **Emisión**: en «Emitir factura» hay una sección de retenciones (solo con receptor persona moral, RFC de 12 caracteres): `retentions: {isr, iva}` en `POST /api/v1/sales/{id}/invoice`. Se envían a Fiscalapi como `itemTaxes` con `taxFlagCode: "R"` (ISR `001` a 0.0125, IVA `002` a 0.106667). **Quién decide si aplican es el emisor con su contador**: Procura no las activa sola, y el portal público de autofacturación nunca las aplica (vende a público).
- **Pendiente de verificar**: la primera emisión real con retenciones (el formato de `itemTaxes` con `R` viene de la documentación de Fiscalapi; el cálculo de importes lo hace el proveedor).

## Importar ventas desde un punto de venta

En **Ventas → Importar ventas** se sube el CSV que exporta el punto de venta (o el corte diario). No hay POS propio: se evita el doble registro.

- Detecta el encabezado (fecha + total obligatorios; folio, descripción, forma de pago, estatus y cliente opcionales). Acepta `,` o `;` y UTF-8 / Windows-1252.
- Omite ventas canceladas, devoluciones (negativas) y filas inválidas; lo informa en la vista previa.
- El total del ticket se toma como IVA incluido (16 %, 8 % o 0 %); subtotal + IVA suma exactamente el total.
- Conserva el folio del ticket como folio de la venta (sirve para el portal de autofacturación); sin folio se asigna `VTA-xxxxx`.
- Idempotente: cada fila lleva `external_ref` (`F:<folio>` o hash), reimportar no duplica. Un folio ya usado por otra venta se informa y no se crea.
- Por omisión quedan cobradas (crea el cobro con la forma de pago); se puede desmarcar.
- Límite: 1,000 ventas por archivo. Acepta CSV y Excel (.xlsx; se usa la primera hoja con datos, convertida en el navegador). Permiso `sale.manage` (+ `payment.manage` si cobra). Endpoint: `POST /api/v1/sales/import` (`dry_run` para la vista previa).

## Comprobantes en una venta

En el detalle de una venta, la tarjeta **Comprobantes** guarda tickets de depósito, recibos o cualquier soporte de la venta y de sus cobros (adjunto con ancla `SALE`, interno, nunca compartido). Ver requiere `sale.read`; subir, `attachment.upload`. Una venta puede tener varios cobros parciales (p. ej. un acuerdo en tres pagos): el cobro y la facturación siguen siendo independientes.

## Registrar una venta desde un ticket (foto o PDF)

En **Ventas → Desde ticket**: se toma la foto o se sube el PDF del ticket de venta, el lector de Claude (el mismo de gastos, función OCR del plan Negocio) propone folio, fecha, total, IVA y forma de pago, y la persona revisa y confirma. Al guardar se crea la venta con el folio del ticket (sirve para el portal de autofacturación; si el folio ya existe no se duplica), opcionalmente cobrada, y el ticket queda como comprobante de la venta. Endpoint: `POST /api/v1/sales/scan` (solo lee, no guarda; permiso `sale.manage`, 60 lecturas por hora). Requiere `ANTHROPIC_API_KEY` en el servidor.

## Estado de cuenta en PDF (BBVA y otros)

En **Banco → Importar movimientos** se puede subir el **PDF** del estado de cuenta además del CSV. El lector de Claude extrae los movimientos (fecha de operación, descripción, cargos, abonos, saldo y referencia; deduce el año con el periodo) y los convierte en el mismo CSV de siempre, que pasa por la vista previa, la detección de duplicados y la confirmación habituales: reimportar el mismo periodo no duplica. Cruza lo leído contra los totales de cargos y abonos que imprime el propio estado de cuenta y avisa si no cuadran (señal de que falta algún movimiento). Endpoint: `POST /api/v1/bank/accounts/{id}/read-pdf` (solo lee, no guarda; planes con banco y OCR, 20 lecturas por hora, PDF de hasta 10 MB). Requiere `ANTHROPIC_API_KEY`.

## Conciliación con gastos en otra moneda

Para un cargo de una cuenta en pesos, además de las coincidencias exactas de importe, Banco ofrece los **gastos pendientes en otra moneda** (p. ej. USD pagados con tarjeta en pesos). El importe no coincide porque lo fija el banco, así que se puntúan por fecha (el cargo suele llegar hasta 30 días después; 5 días antes como máximo) y por nombre, y se muestra el **tipo de cambio implícito** (cargo ÷ importe del gasto; en cuentas en pesos se descartan los fuera de 10–40). Al conciliar, el gasto queda pagado completo **en su propia moneda** y la nota del pago guarda lo que cargó el banco y el tipo de cambio.

## Crear una venta o ingreso desde un abono del banco

En **Banco → Por conciliar**, un abono sin venta registrada (un pago de Stripe, un anticipo, un SPEI de un cliente) tiene el botón **Crear venta**: se captura la descripción, el cliente (opcional; un nombre nuevo lo crea) y si el abono ya incluye IVA de 16 %, 8 % o no lleva. Se crea la venta por el importe del abono (subtotal + IVA suman exacto), ya cobrada con la fecha del banco, y el movimiento queda conciliado. Endpoint: `POST /api/v1/bank/transactions/{id}/sale` (`sale.manage` + `payment.manage`). Solo abonos; un abono ya conciliado no se puede usar dos veces. Deshacer la conciliación no borra la venta: se anula desde Ventas.

## Pegar una captura para registrar un gasto

En la lista de **Gastos**, ⌘V (o Ctrl+V) con una imagen en el portapapeles —por ejemplo una captura de pantalla del Mac— abre «Escanear ticket» y la lee como un gasto nuevo: se revisa y, al guardar, la captura queda como evidencia del gasto. Con un gasto abierto, ⌘V la adjunta a ese gasto en lugar de crear otro. En el detalle de una venta, ⌘V la agrega a sus comprobantes.

## Calculadora de monto neto (retenciones)

En **Registrar venta**, «Calcular desde el monto neto que quiero recibir»: se escribe lo que el cliente pagará ya con IVA y retenciones y devuelve el subtotal a facturar (`lib/commercial/net-amount.ts`; ISR 1.25 %, IVA retenido 10.6667 %, IVA 16 %, redondeo como el timbrado). «Usar este subtotal» llena el primer concepto y deja una nota en la venta; las retenciones se activan al emitir la factura (casillas de «Emitir factura»). Ejemplo: para recibir $2,088.00 netos se factura un subtotal de $2,006.09; para $10,000.00, $9,607.69.
