# Estructura comercial y rentabilidad de Procura

Este documento acompaña a `src/lib/commercial/plans.ts` (planes, límites y paquetes) y `src/lib/commercial/economics.ts` (cálculo de margen). Es información **comercial**: hoy el sistema **no cobra, no aplica límites por plan y no tiene créditos**.

## 1. Diagnóstico del sistema (antes de los cambios)

| Tema | Estado |
|---|---|
| Pasarela de pago / Stripe / suscripciones | Al momento del diagnóstico **no existía**. Después se implementó (ver `docs/BILLING.md`), en modo de prueba y sin crear nada en tu cuenta de Stripe. |
| Créditos de timbrado, saldos, prepago | Al momento del diagnóstico **no existían** (ahora hay libro de créditos, ver `docs/BILLING.md`). La emisión usa la cuenta de Fiscalapi de la organización y deja registro en `fiscal_issue_requests`. |
| Límites por plan (usuarios, almacenamiento, descargas) | **No existen.** Solo topes técnicos: 10 MB por archivo, 60 escaneos/hora por organización, tamaño de adjuntos por organización. |
| Emisión y timbrado | Implementada (Fiscalapi): emisión, PDF, cancelación, retenciones de RESICO y portal de autofacturación. **Aún sin probar con un timbrado real.** |
| Recuperación de CFDI del SAT | Implementada (Fiscalapi), registrada por solicitud en `fiscal_sync_imports`. Es independiente de la emisión. |
| OCR | Implementado. **No se medía** el consumo (solo un límite de frecuencia): ahora cada lectura se registra (`expense.scanned`). |
| Detección de duplicados | Implementada en el escaneo (fecha + importe, y referencia del documento) y en la carga de CFDI (folio fiscal único). |
| Conciliación bancaria | Implementada **solo por archivo CSV**. |
| Cuentas por cobrar y por pagar | Implementadas (saldos en Finanzas). |
| Exportación de información fiscal y financiera | **No existe** (solo importaciones). No se anuncia. |

## 2. Planes (MXN, más IVA)

| Plan | Precio | Incluye (solo lo implementado) |
|---|---|---|
| Esencial | $499/mes | Ingresos y gastos, comprobante por gasto, notas, listados con estados |
| Control (recomendado) | $999/mes | Esencial + pagos parciales, saldos por cobrar/pagar, CFDI ligados, Finanzas con reportes, datos para el contador |
| Negocio | $1,799/mes | Control + recuperación de CFDI del SAT (con límites), OCR, duplicados, conciliación CSV, emisión/cancelación, portal de autofacturación |

**Tres conceptos separados:** (1) suscripción, (2) recuperación de CFDI del SAT (costo variable del proveedor, con límites pendientes), (3) timbrado (créditos aparte, aún no disponibles).

## 3. Costos reales observados (gastos de la organización)

- **Timbre:** 100 timbres = $170.52 con IVA → **$1.47 + IVA por timbre ($1.71 con IVA).** El $4 de la propuesta es un precio de referencia, **no el costo de Fiscalapi**.
- **Suscripción de emisión de Fiscalapi:** $199.00/mes con IVA → $171.55 sin IVA.
- **Descarga masiva de CFDI (Fiscalapi):** el único cargo observado es **$98.94 con IVA por «tiempo restante»**; **el precio del mes completo se desconoce.** El plan cuenta un asiento por RFC y dirección.
- **Infraestructura (fija, antes de clientes):** ≈ USD 201.61/mes (Supabase, Vercel, Resend) + lo de Fiscalapi.
- **OCR (Anthropic):** costo por lectura **desconocido**; ahora hay conteo para calcularlo con tu consumo real.
- **Comisión de cobro:** no hay pasarela. Para el cálculo se usa la tarifa pública de lista de Stripe México (3.6% + $3 + IVA); **debe verificarse al contratar**.

## 4. Recuperación de CFDI del SAT: política

- **Incluida** en Negocio. **Límites: PENDIENTES** (`SAT_RECOVERY.limits` en `null`); no se promete volumen ni se cobra excedente (`overage.enabled = false`).
- El costo del proveedor es **por RFC y dirección, no por CFDI**: por eso «más CFDI recuperados» no sube el costo, pero «más RFC» sí.
- **Evitar duplicadas:** una solicitud cuyo periodo ya está cubierto por otra vigente (misma regla, no rechazada) **no se vuelve a pedir** (`coveredByExisting`).
- **Medición:** `GET /api/v1/organization/fiscal-usage?month=AAAA-MM` entrega, por organización/RFC y por separado: timbrados (app y portal público), recuperación del SAT (solicitudes, CFDI nuevos, ya existentes, errores) y lecturas de OCR.
- **Para fijar los límites** hace falta el precio del mes completo de la descarga y si Fiscalapi cobra por solicitud o por volumen. Recomendación mientras tanto: máximo 1 RFC por organización y solicitudes de hasta 30 días (límite del SAT).

## 5. Paquetes de timbrado (propuesta: 50/$200, 100/$350, 500/$1,250)

**No se activan.** No hay prepago, saldo ni cobro. Verificación económica de la propuesta:

| Paquete | Precio por CFDI | Costo por timbre (sin IVA) | Margen bruto por CFDI | Margen por paquete |
|---|---|---|---|---|
| 50 | $4.00 | $1.47 | $2.53 | $126.50 |
| 100 | $3.50 | $1.47 | $2.03 | $203.00 |
| 500 | $2.50 | $1.47* | $1.03 | $515.00 |

\* El costo de $1.47 sale de un paquete de 100; el costo en volumen se desconoce.

**Compatibilidad:** el margen por timbre es positivo en los tres. **Riesgos a resolver antes de activarlos:**
1. Si Fiscalapi cobra su suscripción de emisión **por RFC** ($171.55), un cliente que solo compre un paquete de 50 deja $126.50: **no cubre ese costo fijo**. Los paquetes solo son rentables con una suscripción activa o con volumen.
2. La comisión de cobro pesa más en paquetes chicos (≈ 6.6% en el de $200).
3. Para activarlos se necesita: saldo y libro de consumo por cuenta, descuento solo tras timbrado exitoso, idempotencia por reintento, historial consultable y vínculo de cada compra con su organización. Hoy `fiscal_issue_requests` da la base (una emisión por venta, estados y reintento seguro).

## 6. Escenarios de rentabilidad (margen de contribución mensual)

**Antes de infraestructura, OCR, soporte y tu tiempo.** Recuperados del SAT y emitidos se muestran en filas independientes. Los créditos se valúan al precio del paquete propuesto. El costo de recuperación se modela como **fijo por RFC** (se desconoce si hay un costo por CFDI). Esencial y Control no incluyen recuperación del SAT.

timbre sin IVA: $1.47 | suscripción de emisión sin IVA: $171.55


### Caso A (favorable): descarga masiva $85.29/mes por RFC; suscripción de emisión por RFC: no

| Plan | Operación | CFDI | Suscripción | Créditos | Costo timbres | Costo emisión fija | Costo descarga SAT | Comisión de cobro | **Margen** |
|---|---|---|---|---|---|---|---|---|---|
| esencial | Emitidos (timbrados) | 25 | $499.00 | $100.00 | $36.75 | $0.00 | $0.00 | $32.50 | **$529.75** |
| esencial | Emitidos (timbrados) | 100 | $499.00 | $350.00 | $147.00 | $0.00 | $0.00 | $44.61 | **$657.39** |
| esencial | Emitidos (timbrados) | 500 | $499.00 | $1,250.00 | $735.00 | $0.00 | $0.00 | $88.20 | **$925.80** |
| control | Emitidos (timbrados) | 25 | $999.00 | $100.00 | $36.75 | $0.00 | $0.00 | $56.72 | **$1,005.53** |
| control | Emitidos (timbrados) | 100 | $999.00 | $350.00 | $147.00 | $0.00 | $0.00 | $68.83 | **$1,133.17** |
| control | Emitidos (timbrados) | 500 | $999.00 | $1,250.00 | $735.00 | $0.00 | $0.00 | $112.43 | **$1,401.57** |
| negocio | Recuperados del SAT | 25 | $1,799.00 | $0.00 | $0.00 | $0.00 | $85.29 | $90.63 | **$1,623.08** |
| negocio | Emitidos (timbrados) | 25 | $1,799.00 | $100.00 | $36.75 | $0.00 | $0.00 | $95.47 | **$1,766.78** |
| negocio | Recuperados del SAT | 100 | $1,799.00 | $0.00 | $0.00 | $0.00 | $85.29 | $90.63 | **$1,623.08** |
| negocio | Emitidos (timbrados) | 100 | $1,799.00 | $350.00 | $147.00 | $0.00 | $0.00 | $107.58 | **$1,894.42** |
| negocio | Recuperados del SAT | 500 | $1,799.00 | $0.00 | $0.00 | $0.00 | $85.29 | $90.63 | **$1,623.08** |
| negocio | Emitidos (timbrados) | 500 | $1,799.00 | $1,250.00 | $735.00 | $0.00 | $0.00 | $151.18 | **$2,162.82** |

### Caso B (conservador): descarga masiva $258.62/mes por RFC; suscripción de emisión por RFC: sí

| Plan | Operación | CFDI | Suscripción | Créditos | Costo timbres | Costo emisión fija | Costo descarga SAT | Comisión de cobro | **Margen** |
|---|---|---|---|---|---|---|---|---|---|
| esencial | Emitidos (timbrados) | 25 | $499.00 | $100.00 | $36.75 | $171.55 | $0.00 | $32.50 | **$358.20** |
| esencial | Emitidos (timbrados) | 100 | $499.00 | $350.00 | $147.00 | $171.55 | $0.00 | $44.61 | **$485.84** |
| esencial | Emitidos (timbrados) | 500 | $499.00 | $1,250.00 | $735.00 | $171.55 | $0.00 | $88.20 | **$754.25** |
| control | Emitidos (timbrados) | 25 | $999.00 | $100.00 | $36.75 | $171.55 | $0.00 | $56.72 | **$833.98** |
| control | Emitidos (timbrados) | 100 | $999.00 | $350.00 | $147.00 | $171.55 | $0.00 | $68.83 | **$961.62** |
| control | Emitidos (timbrados) | 500 | $999.00 | $1,250.00 | $735.00 | $171.55 | $0.00 | $112.43 | **$1,230.02** |
| negocio | Recuperados del SAT | 25 | $1,799.00 | $0.00 | $0.00 | $0.00 | $258.62 | $90.63 | **$1,449.75** |
| negocio | Emitidos (timbrados) | 25 | $1,799.00 | $100.00 | $36.75 | $171.55 | $0.00 | $95.47 | **$1,595.23** |
| negocio | Recuperados del SAT | 100 | $1,799.00 | $0.00 | $0.00 | $0.00 | $258.62 | $90.63 | **$1,449.75** |
| negocio | Emitidos (timbrados) | 100 | $1,799.00 | $350.00 | $147.00 | $171.55 | $0.00 | $107.58 | **$1,722.87** |
| negocio | Recuperados del SAT | 500 | $1,799.00 | $0.00 | $0.00 | $0.00 | $258.62 | $90.63 | **$1,449.75** |
| negocio | Emitidos (timbrados) | 500 | $1,799.00 | $1,250.00 | $735.00 | $171.55 | $0.00 | $151.18 | **$1,991.27** |


**Lectura:** con estas cifras cada cliente deja entre ≈ $360 y ≈ $2,160 al mes antes de gastos generales. Con una infraestructura fija de ≈ $4,000/mes, el punto de equilibrio está en unos **4 a 8 clientes** según el plan, **sin pagar tu tiempo**.

## 7. Pendientes y riesgos antes de publicar

1. **No hay cobro:** la página invita a crear cuenta; no existe forma de contratar y cobrar. Falta decidir la pasarela.
2. **Los planes no se aplican:** nada impide que un cliente use funciones de Negocio. Se necesita un campo de plan por organización y la verificación en las rutas.
3. **Precio de la descarga masiva del mes completo** y si Fiscalapi cobra por RFC adicional (una cuenta de Fiscalapi por cliente o un solo tenant).
4. **Costo por lectura de OCR.**
5. **Exportación:** no existe; los planes no la prometen.
6. **Límites de usuarios y almacenamiento:** definirlos y aplicarlos.
7. **Conflicto con los planes de compras:** Control ($999) incluye gastos, mientras que Starter de compras cuesta $1,490. Decidir si se venden juntos o por separado.
8. **Probar un timbrado real** antes de vender la emisión como lista.
