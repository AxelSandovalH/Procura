# Cobro con Stripe

Suscripción mensual (tres planes) y paquetes de créditos de timbrado. **Empieza en modo de prueba**: nada cobra dinero real hasta que pongas claves de producción.

## Cómo funciona
- **Planes** (`lib/commercial/plans.ts`): Esencial $499, Control $999, Negocio $1,799, mensuales, más IVA. Sin periodo de prueba gratis, sin plan anual por ahora.
- **Contratar**: Administración → Plan y cobro → «Contratar». Solo el **administrador principal** de la organización. Lleva a Stripe Checkout y regresa a Procura. Cambiar de plan, actualizar la tarjeta, ver recibos y cancelar se hace en el **portal de Stripe** («Administrar suscripción»).
- **El plan lo decide el webhook**, no el regreso del navegador: `POST /api/v1/billing/webhook` (firma verificada con `STRIPE_WEBHOOK_SECRET`, cada evento se procesa una sola vez). Eventos usados: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Acceso por plan** (`lib/billing/entitlements.ts`): Control → reportes de Finanzas y módulo de CFDI; Negocio → banco, recuperación del SAT, OCR, emisión/cancelación/PDF y portal de autofacturación. Una función fuera del plan responde **402** con el plan requerido.
- **Organizaciones sin suscripción** conservan **acceso completo** (cuentas anteriores al cobro): no se les quita nada.
- **Pago fallido**: **7 días de gracia** con el plan; después queda en «sin plan activo» (solo lo básico: gastos, ventas, lectura). **Nunca se borran datos.**
- **Créditos de timbrado** (paquetes de 50, 100 y 500, pago único): se abonan al confirmarse el pago (también OXXO o SPEI, que confirman después). Al comprar el primer paquete, la organización pasa a **consumir un crédito por cada timbrado exitoso**. Se descuenta solo tras la respuesta exitosa del proveedor; un error no cobra; el consumo es idempotente (una vez por solicitud de emisión) y hay saldo e historial. Saldo disponible = saldo − emisiones en curso. No hay devolución automática de créditos (cancelar un CFDI no reintegra el timbre).

## Qué configurar en Stripe (modo de prueba)
**Los precios los pone Procura**: no hay que crear precios ni tasas de impuesto en Stripe. Cada cobro viaja con su importe (los de `lib/commercial/plans.ts`), y el IVA 16% se suma con una tasa que Procura reutiliza si ya existe en tu Stripe o crea la primera vez. Los productos («Procura Esencial», «Paquete de 50 timbres de CFDI»…) también se crean solos, con id fijo, la primera vez que alguien compra. Para cambiar un precio basta cambiarlo en el código.

1. Cuenta de Stripe México verificada.
2. **Webhook** (después de desplegar): Desarrolladores → Webhooks → agrega `https://www.procuraos.app/api/v1/billing/webhook` con los eventos de arriba y copia su secreto `whsec_…`.
3. **Portal de clientes** (opcional): actívalo en Configuración → Portal de facturación para que tus clientes actualicen su tarjeta, vean recibos y cancelen. El cambio de plan se hace dentro de Procura (prorratea la diferencia).
4. **Variables de entorno** (Vercel y `.env.local`; las claves NUNCA van en el chat ni en el código): solo **`STRIPE_SECRET_KEY`** y **`STRIPE_WEBHOOK_SECRET`**. Redespliega después de cambiarlas.

## Para pasar a producción
Cambia las dos variables por las de **modo real** (la clave y el secreto del webhook de modo real son distintos de los de prueba) y prueba una compra pequeña. Antes: verifica la comisión real de Stripe México y decide cómo emitirás tu propia factura (CFDI) a cada cliente por su pago: **Stripe no emite CFDI**.

## Pruebas
`tests/integration/billing.smoke.mjs` simula los eventos firmados de Stripe (sin llamar a Stripe) y comprueba abono idempotente de créditos, plan, restricción de funciones, gracia, vencimiento y que un timbrado fallido no descuenta crédito. Lo que **no** puede probar sin tus claves de prueba: crear la sesión de pago, el cambio de plan y el portal en Stripe. Eso se prueba una vez con una compra de prueba.

## Operación
- Ajustar créditos a mano (soporte): `insert into stamp_credit_ledger (organization_id, delta, kind, reference, note) values (…, 50, 'ADJUST', 'motivo-único', 'por qué');`
- Auditoría: `billing.checkout_started`, `billing.credits_purchased`, `billing.subscription_changed`, `billing.payment_failed`.
