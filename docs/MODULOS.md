# Módulos de Procura

El menú tiene **nueve módulos** (`src/lib/ui/modules.ts`, única fuente). Cada uno agrupa rutas existentes y muestra sus secciones como pestañas. Un módulo aparece si la persona puede ver al menos una de sus secciones.

| Módulo | Qué contiene | Rutas |
|---|---|---|
| **Compras** | Gastos con lectura de tickets (OCR) y todo el flujo de compras entre proveedores | Gastos `/gastos` · Comprar `/comprar` · Requisiciones · Aprobaciones · Cotizaciones `/solicitudes` · Órdenes |
| **Ventas** | Registro de ventas y emisión de sus facturas | `/ventas`, `/ventas/[id]` |
| **Facturas** | Pestañas **Emitidas**, **Recibidas** y **Descarga masiva del SAT** | `/facturas` |
| **Conciliación bancaria** | Cuentas, estados de cuenta (CSV) y conciliación | `/banco` |
| **Finanzas** | **Resumen** con gráficas y **Exportaciones** para el equipo contable | `/finanzas`, `/finanzas/exportaciones` |
| **Relaciones** | Proveedores y clientes en Procura; **clientes para facturar** con sus datos fiscales | `/relaciones`, `/relaciones/clientes` |
| **Suscripción** | Estado del plan y del pago, y compra de timbres | `/suscripcion` |
| **Catálogo** | Catálogo de productos o servicios | `/catalogo` |
| **Administración** | Miembros, roles, estructura, flujos, integraciones y organización | `/administracion/*` |

`/inicio` (el panel anterior) sigue existiendo, pero ya no está en el menú. `/administracion/plan` redirige a `/suscripcion`.

## Exportaciones (Finanzas → Exportaciones)
`GET /api/v1/finance/export?type=…&from=AAAA-MM-DD&to=AAAA-MM-DD` (permiso `finance.read`, plan Control o superior, límite de 30 por 10 minutos, queda en la bitácora como `finance.exported`):
- **CSV compatibles con Excel** (UTF-8 con BOM, montos en pesos sin separadores, fechas AAAA-MM-DD, celdas que empiezan con `= + - @` neutralizadas): `gastos`, `ventas`, `pagos`, `cfdi_emitidos`, `cfdi_recibidos`, `banco`.
- **ZIP de XML** (`xml_emitidos`, `xml_recibidos`): hasta 150 CFDI por descarga, con un `indice.csv`.
- Periodo máximo de 400 días y 20,000 filas por archivo.
