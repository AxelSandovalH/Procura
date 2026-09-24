# PROCURA — Análisis y Decisiones Abiertas

> **Parte 1**: hallazgos del análisis del brief (inconsistencias, ambigüedades, riesgos, faltantes).
> **Parte 2**: decisiones abiertas (`OD-nn`) con opciones y recomendación. **Ninguna está tomada.**
> **Parte 3**: supuestos de diseño usados en los documentos, pendientes de tu confirmación.

---

## Estado de decisiones (actualizado 2026-09-23)

| OD | Decisión | Detalle |
|---|---|---|
| OD-01 | ✅ **d** | **Next.js** desplegado en **Vercel** + **Supabase** (PostgreSQL, Auth, Storage). Ver OD-34/35/36 (derivadas). |
| OD-02 | ✅ **a** | Requisición dirigida: al aprobarse emite RFQ automática al proveedor del portal; Compras no elige. Solicitante puede sugerir proveedor (no vinculante) en el flujo interno. |
| OD-03 | ✅ **a** | Solo se acepta cotización completa; `split` de requisición antes de aceptar. *Pendiente confirmar: `split` en MVP (★) o v1.1.* |
| OD-10 | ✅ **a** | Departamentos a nivel organización; requisición lleva (departamento, localización). |
| OD-12 | ✅ **a** | Relación direccional `unique(buyer, supplier)`. Caso real: Papillon (yates) compra a Avocabo (frutas y verduras); la dirección inversa es posible pero atípica. |
| OD-16 | ✅ **a** | Número global Procura + `buyer_reference` / `supplier_reference` libres. |
| OD-22 | ✅ **a** | API key con roles del mismo RBAC. ERP: crear/consultar/cancelar requisiciones, consultar órdenes/entregas/recepciones, recibir eventos. No edita ni aprueba. |
| OD-34 | ✅ **c** | Cola gestionada **Inngest**: dispatcher del outbox, webhooks con reintentos/backoff, emails. Jobs programados (expiración, auto-cierre) como funciones cron de Inngest. |
| OD-35 | ✅ **a** | **Supabase Auth**. `users` de Procura = perfil 1:1 con `auth.users`; membership activo en el token/cookie. |
| OD-36 | ✅ **a** | Backend en **Route Handlers de Next.js** con policy engine en aplicación; la UI nunca consulta tablas con el JWT del usuario; **RLS como segunda barrera**; ORM **Drizzle**; migraciones con Drizzle Kit. |
| OD-04 … OD-33 | ★ aplicadas (2026-09-24) | Sin respuesta explícita; el esquema usa la recomendación ★ de cada una. Todas son reversibles con una migración pequeña. Ver DATABASE_SCHEMA.md §2. |
| OD-37 | ⏳ | ORM: Drizzle (★ del blueprint) vs **Prisma** (lo usa papillon-erp). Bloquea arquitectura backend, no el esquema. |

---

## Parte 1 — Hallazgos

### 1.1 Inconsistencias

| # | Hallazgo | Dónde | Cómo se trató en los docs |
|---|---|---|---|
| H-01 | **"Organización destino" en la requisición vs "Compras decide el proveedor".** §9 la define como campo de la requisición; §12 dice que el solicitante solo sugiere. Son dos semánticas distintas. | Brief §9, §12, §22 | Dos campos: `suggested_supplier_organization_id` (no vinculante) y `directed_supplier_organization_id` (portal). → **OD-02** |
| H-02 | **Departamentos anidados bajo sucursales en el ejemplo, pero definidos como entidades independientes.** El árbol de §3 muestra `Cabo San Lucas → Operaciones`; §5 los trata como dimensiones separadas. | Brief §3, §5 | Modelados a nivel organización, independientes; la requisición lleva el par (dpto, loc). → **OD-10** |
| H-03 | **Una requisición → una orden, pero el proveedor puede declinar conceptos o cotizar parcialmente.** Si la cotización aceptada no cubre todos los conceptos, quedan conceptos sin resolver en una requisición que ya no puede generar otra orden. | Brief §12, §13 | → **OD-03** (split de requisición o aceptación solo de cotizaciones completas) |
| H-04 | **Estado `SENT` con nombre ambiguo.** "Enviada" ¿a aprobación o a proveedores? El brief ya tiene `PENDING_APPROVAL`, así que `SENT` = RFQ emitidas. | Brief §10 | Se conserva el nombre con esa definición; sugerencia opcional: renombrar a `SOURCING`. |
| H-05 | **`quotation.received` como nombre de evento** es perspectiva del comprador; el mismo hecho para el proveedor es "enviada". | Brief §23, §27 | Nombre canónico `quotation.submitted`, un envelope por organización con perspectiva. → **OD-29** |
| H-06 | **Relaciones "iniciadas por cualquiera" pero sin dirección declarada.** Quien inicia debe decir si será comprador o proveedor; la unicidad depende de si la relación es direccional. | Brief §6 | Relación direccional buyer→supplier; el iniciador declara su posición. → **OD-12** |
| H-07 | **Conversación compartida "asociada a la requisición".** La requisición es interna; el proveedor no la ve. La conversación compartida solo puede colgar de la RFQ (una por proveedor). | Brief §7, §21 | Thread SHARED ancla en RFQ/Quotation/Order/Delivery; en requisición solo INTERNAL. |
| H-08 | **Tipo de requisición (Goods/Service/Mixed) como campo capturado.** Es derivable de los conceptos; capturarlo permite inconsistencias. | Brief §9 | Derivado. |
| H-09 | **"Proveedor marca IN_PROCESS manualmente" vs registrar entrega sobre una orden CONFIRMED.** Registrar una entrega es evidencia de que está en proceso. | Brief §15, §17 | Registrar entrega también pasa a IN_PROCESS (ver WORKFLOWS §6 nota). Confirmar. |

### 1.2 Ambigüedades que bloquean el esquema

| # | Ambigüedad | → |
|---|---|---|
| A-01 | ¿Puede el proveedor re-enviar una cotización revisada? ¿Cotizaciones sin RFQ previa? | OD-04 |
| A-02 | ¿Aceptación parcial de una cotización (solo algunas líneas)? | OD-05 |
| A-03 | ¿Hay aprobación después de conocer el precio real (cotización > presupuesto)? El brief solo tiene una caja de aprobación. | OD-06 |
| A-04 | ¿Qué cambios disparan re-aprobación? ¿Se puede editar después de emitir RFQ? | OD-07 |
| A-05 | ¿Qué pasa cuando ningún aprobador coincide con la regla? | OD-09 |
| A-06 | ¿Un aprobador con scope de localización puede aprobar una requisición cuyos conceptos van a dos localizaciones? | OD-11 |
| A-07 | ¿Suspender una relación afecta órdenes en curso? | OD-13 |
| A-08 | Tras cancelación de orden, ¿se puede aceptar otra cotización aún vigente o hay que re-cotizar? | OD-14 |
| A-09 | ¿Se puede cancelar una orden con entregas parciales ya recibidas? ¿Quién cierra "corto"? | OD-15 |
| A-10 | Numeración: la orden es compartida; ¿folio de quién? | OD-16 |
| A-11 | `RESOLVED` vs `CLOSED`: ¿qué añade `CLOSED`? | OD-24 |
| A-12 | ¿Quién puede cancelar una requisición y hasta qué estado? (no está en el brief) | OD-30 |
| A-13 | Diferencia práctica entre Duplicate y Reorder. | OD-28 |
| A-14 | ¿El proveedor puede editar/cancelar una entrega antes de que el comprador la confirme? | OD-31 |

### 1.3 Riesgos

| # | Riesgo | Impacto | Mitigación propuesta |
|---|---|---|---|
| R-01 | **Suplantación de organizaciones.** Cualquiera puede crear "Avocabo" y recibir RFQs por error. | Alto (confianza, fuga de datos comerciales) | `is_discoverable` off por defecto; relaciones por invitación en fase inicial; badge "verificada" en v1.1 (OD-20). |
| R-02 | **Fuga de campos privados por serialización.** El error clásico: un `include` o un webhook que arrastra `budget_max`. | Alto | Campos privados en tablas separadas (no hay nada que filtrar); serializers por perspectiva; tests negativos obligatorios. |
| R-03 | **Explosión de estados derivados** (requisición ↔ orden ↔ entregas). | Medio | Transiciones derivadas en la misma transacción; una sola función `recomputeRequisitionStatus(order)`. |
| R-04 | **Motor de aprobación sobre-diseñado** antes de tener usuarios. | Medio | MVP: secuencial, condiciones simples, `ANY_ONE`/`ALL`. Nada de paralelo, delegación ni escalado por tiempo. |
| R-05 | **Importación de catálogos sucios** (unidades libres, SKUs duplicados, encodings). | Medio | Pipeline con preview y warnings; upsert por SKU; unidades normalizadas (OD-18). |
| R-06 | **Adjuntos maliciosos** compartidos entre organizaciones. | Medio | MIME por magic bytes, límite de tamaño, dominio separado para descarga, antivirus en v1.1. |
| R-07 | **Un usuario en dos organizaciones que se relacionan entre sí** (Juan en Papillon y en ABC, y ABC cotiza a Papillon). | Medio (conflicto de interés, no técnico) | Es legítimo por diseño; el contexto activo evita mezcla de datos; auditoría lo hace visible. Documentar. |
| R-08 | **Webhooks como único canal para ERPs.** Muchos ERPs on-prem no exponen HTTPS público. | Medio | Feed `GET /events` con cursor como alternativa pull (incluido en API.md). |
| R-09 | **Stack no decidido** → cualquier diseño de esquema es tentativo. | Alto (bloquea fase siguiente) | OD-01 primero. |

### 1.4 Faltantes en el brief (añadidos en los docs)

| Tipo | Elemento | Doc |
|---|---|---|
| Entidad | `QuotationRequest` (RFQ) como entidad propia, separada de la cotización | DOMAIN_MODEL §9 |
| Entidad | `Invitation` (membership y relación) | DOMAIN_MODEL §2 |
| Entidad | `ApiKey` como principal con roles | DOMAIN_MODEL §2 |
| Entidad | `OrganizationSettings` | DOMAIN_MODEL §3 |
| Entidad | `QuotationSupplierPrivate`, `OrderPartyPrivate` (lados privados de entidades compartidas) | DOMAIN_MODEL §9–10 |
| Entidad | `Receipt` separada de `Delivery` | DOMAIN_MODEL §11 |
| Entidad | `Thread` con visibilidad, `Attachment` con visibilidad | DOMAIN_MODEL §12 |
| Entidad | `DomainEvent` (outbox), `WebhookDelivery` | DOMAIN_MODEL §13 |
| Estado | Requisition: `REJECTED`, `CANCELLED` | WORKFLOWS §1 |
| Estado | Order: `PENDING_CONFIRMATION`, `REJECTED`, `COMPLETED`, `CANCELLED` | WORKFLOWS §5 |
| Estado | Quotation: máquina completa | WORKFLOWS §4 |
| Estado | RFQ: máquina completa | WORKFLOWS §3 |
| Estado | Relationship: `REJECTED`; Membership: máquina completa | WORKFLOWS §8 |
| Acción | `requisition.cancel`, `requisition.withdraw` (de aprobación), `rfq.withdraw`, `order.close_short`, `quotation.revise/extend`, `delivery.cancel` | WORKFLOWS |
| Permiso | Granularidad admin (`member.*`, `role.*`, `admin.transfer_primary`), `requisition.read_private`, `quotation.read_private`, `order.close_short`, `rfq.*` | RBAC §2 |
| Regla | No-escalación al asignar roles | RBAC §5 |
| Regla | Idempotencia y `If-Match` en API | API §1 |
| Regla | Versionado de requisición ligado a aprobación | DOMAIN_MODEL §7 |
| Mecanismo | Feed de eventos pull (`GET /events`) | API §11 |

---

## Parte 2 — Decisiones abiertas

Cada una: **contexto · opciones · recomendación · qué bloquea**. Marcadas 🔴 las que bloquean el esquema de BD.

### 🔴 OD-01 — Stack tecnológico
> ✅ **DECIDIDO (2026-09-23):** opción **d** — Next.js en Vercel + Supabase (PostgreSQL). Ver OD-34, OD-35, OD-36.

**Contexto**: no está definido lenguaje, framework, BD ni hosting. Todo el diseño es agnóstico salvo la recomendación de PostgreSQL.
**Opciones**: (a) TypeScript end-to-end (NestJS/Fastify + Prisma/Drizzle + Next.js/React); (b) Python (Django + DRF o FastAPI) + React; (c) PHP (Laravel) + Inertia/React; (d) otro que el equipo domine.
**Recomendación**: **PostgreSQL** en cualquier caso (RLS, jsonb, tsvector, transacciones sólidas para outbox). Backend: el que tu equipo pueda mantener; si no hay preferencia, (a) por compartir tipos entre API y UI. Hosting: managed Postgres + contenedores; storage S3-compatible; email transaccional (Resend/SES/Postmark).
**Bloquea**: todo lo siguiente.

### 🔴 OD-02 — Semántica de "organización destino" y requisición dirigida
> ✅ **DECIDIDO (2026-09-23):** opción **a**.

**Contexto**: H-01. Flujo portal (`/avocabo/solicitar`) crea una requisición ya apuntada a Avocabo.
**Opciones**: (a) un solo campo `destination_organization_id` que Compras puede cambiar; (b) dos campos: `suggested_*` (sugerencia) y `directed_*` (vinculante; al aprobarse se emite RFQ automática a ese proveedor y Compras no elige); (c) requisición dirigida salta el paso de Compras por completo.
**Recomendación**: (b). Mantiene "Compras decide" en el flujo interno y hace el portal utilizable por organizaciones pequeñas sin rol Compras. Con (b), ¿Compras puede **añadir** otros proveedores a una requisición dirigida? Recomiendo **no** en MVP.
**Bloquea**: esquema de `requisitions`, flujo portal.

### 🔴 OD-03 — Cotización parcial y conceptos sin cubrir
> ✅ **DECIDIDO (2026-09-23):** opción **a**. Falta confirmar si `split` entra en MVP (★) o v1.1.

**Contexto**: H-03. Regla 6 (una requisición → una orden) choca con líneas `DECLINED` en cotización.
**Opciones**: (a) solo se puede aceptar una cotización que cubra todos los conceptos (líneas DECLINED bloquean aceptación); (b) permitir aceptar parcial y los conceptos no cubiertos quedan "sin resolver" en una requisición ya IN_PROCESS (rompe el modelo mental); (c) acción **`split`**: Compras separa conceptos en una requisición hija (nuevo folio, hereda aprobación) antes de aceptar; cada requisición sigue generando una sola orden.
**Recomendación**: (c) con (a) como validación: si la cotización no cubre todo, la UI ofrece "dividir requisición" y luego aceptar. ¿`split` entra en MVP o v1.1? Recomiendo MVP mínimo (mover conceptos a nueva requisición APPROVED, sin re-aprobación si `reapproval_policy` lo permite).
**Bloquea**: `Requisition.parent_requisition_id`, reglas de aceptación.

### OD-04 — Versiones de cotización y cotizaciones no solicitadas
**Opciones**: (a) una cotización por RFQ, inmutable tras enviar; (b) el proveedor puede `revise` → nueva versión, la anterior `SUPERSEDED`; (c) además, cotizaciones espontáneas sin RFQ.
**Recomendación**: (b). (c) no en MVP.

### OD-05 — Aceptación parcial de cotización
**Opciones**: (a) se acepta la cotización completa; (b) por líneas.
**Recomendación**: (a). Lo parcial se resuelve con OD-03.

### OD-06 — Segunda aprobación tras cotizar (sobre-presupuesto)
**Contexto**: el brief tiene una sola aprobación (sobre la requisición estimada). En procurement real es común aprobar el compromiso de gasto (la orden).
**Opciones**: (a) sin segunda aprobación en MVP; Compras es responsable; (b) regla configurable: si `quotation.total > budget_max` (o `> estimated_total × (1+x%)`), aceptar la cotización requiere aprobación (reutilizando el motor sobre la cotización); (c) aprobación de orden siempre.
**Recomendación**: (a) en MVP, dejando hook explícito para (b) en v1.1 (la comparación ya muestra desvío vs presupuesto en rojo).

### OD-07 — Política de re-aprobación y edición post-aprobación
**Opciones** para `reapproval_policy`: `ALWAYS` · `IF_AMOUNT_INCREASES` · `NEVER`. Y para edición: (a) editable solo en DRAFT; (b) Compras puede editar en APPROVED; (c) editable incluso en SENT (retirando RFQs automáticamente).
**Recomendación**: default `IF_AMOUNT_INCREASES`; edición (b); en SENT obligar `withdraw_rfq` explícito.

### OD-08 — Aprobación por concepto en MVP
**Recomendación**: modelar (hecho) e implementar en v1.1. Si va en MVP, el side-by-side y la RFQ deben excluir conceptos rechazados (ya contemplado).

### OD-09 — Sin aprobador que coincida con la regla
**Opciones**: (a) bloquear el envío con error claro; (b) fallback al Administrador; (c) saltar el nivel.
**Recomendación**: (a) al **configurar** el workflow se valida que exista al menos un aprobador posible; en runtime, si por cambios de membership no hay ninguno, fallback (b) con notificación al admin y auditoría. Nunca (c).
**OD-09b**: si `require_estimated_price=false`, los conceptos sin precio cuentan como 0 para reglas de monto. ¿Aceptable?

### 🔴 OD-10 — Departamentos: nivel organización vs por localización
> ✅ **DECIDIDO (2026-09-23):** opción **a**.

**Opciones**: (a) departamentos globales de la organización; la requisición lleva (dpto, loc) como dos dimensiones; (b) departamentos hijos de localización (`Operaciones@CSL` ≠ `Operaciones@SJC`).
**Recomendación**: (a). Los aprobadores que dependen de ambas dimensiones se cubren con dos asignaciones de scope o con `approver_scope_policy=MATCH_REQUISITION_SCOPE` evaluando ambas. Menos duplicación de maestros.
**Bloquea**: `departments`, scopes.

### OD-11 — Scope vs requisición multi-ubicación
**Contexto**: REQ-00150 con conceptos a dos sucursales; aprobador con scope LOCATION=CSL.
**Opciones**: (a) scopes se evalúan solo contra el header (`location_id` de la requisición); los conceptos multi-ubicación no afectan aprobación; (b) evaluación por concepto (requiere aprobación per-concept, OD-08); (c) requisición multi-ubicación requiere aprobador con scope ORGANIZATION o de todas las localizaciones.
**Recomendación**: (a) en MVP. La **recepción** sí se evalúa por localización de la entrega (ahí importa).

### 🔴 OD-12 — Dirección y unicidad de relaciones
> ✅ **DECIDIDO (2026-09-23):** opción **a**.

**Opciones**: (a) direccional: `unique(buyer_org, supplier_org)`; si ambas se compran mutuamente, dos relaciones; (b) bidireccional: una relación por par, con términos por dirección.
**Recomendación**: (a). Términos, contactos y catálogo compartido son naturalmente direccionales.

### OD-13 — Efectos de SUSPENDED / FINALIZED
**Opciones**: (a) bloquean solo **nuevas** RFQ/cotizaciones/órdenes; lo en curso continúa; (b) además congelan cotizaciones abiertas; (c) FINALIZED cancela todo lo abierto (con motivo automático).
**Recomendación**: SUSPENDED → (a). FINALIZED → (a) + requisito de que no haya órdenes vivas (bloquear finalizar hasta cerrarlas).
**OD-13c**: ¿quién edita `RelationshipTerms`? Recomiendo: cualquiera de las dos con `relationship.manage`; cambios auditados y notificados a la contraparte.

### OD-14 — Cotizaciones tras cancelación/rechazo de orden
**Opciones**: (a) `NOT_SELECTED` es terminal; Compras re-emite RFQ; (b) `NOT_SELECTED` vigentes pueden re-abrirse (`reopen`) y aceptarse.
**Recomendación**: (b) — evita pedir al proveedor que vuelva a cotizar lo mismo. Requiere que `NOT_SELECTED` no sea terminal y que se respete `valid_until`.

### OD-15 — Cancelación con entregas parciales y cierre corto
**Opciones**: (a) no se puede cancelar si hay recepción confirmada; solo `close_short`; (b) cancelar = cancela el remanente, lo recibido queda como está (`CANCELLED` con `completion_mode=PARTIAL`).
**Recomendación**: (a) para comprador y proveedor. `close_short` solo comprador (`order.close_short`), con motivo. ¿El proveedor debería poder proponer cierre corto? Sugiero que lo pida por conversación en MVP.

### 🔴 OD-16 — Numeración de órdenes y demás documentos
> ✅ **DECIDIDO (2026-09-23):** opción **a**.

**Opciones**: (a) número global de Procura (`PRC-000412`) + `buyer_reference` / `supplier_reference` libres; (b) folio por organización compradora; (c) ambos folios generados por Procura (uno por lado).
**Recomendación**: (a). RFQ, cotización, entrega: numeración global también, con referencias opcionales por lado.

### OD-17 — Impuestos y moneda
**Recomendación**: cada cotización/orden lleva `currency` (default: la de la relación), `subtotal`, `tax`, `total` capturados por el proveedor; Procura valida aritmética (`subtotal + tax = total`, Σ líneas = subtotal) pero no calcula impuestos. Sin conversión. Confirmar.

### OD-18 — Unidades de medida
**Opciones**: (a) lista global semilla (PZA, KG, L, M, HR, SERVICIO…) + unidades propias por organización; (b) solo texto libre.
**Recomendación**: (a); en RFQ/cotización viaja `unit_label` (texto), sin conversión.

### OD-19 — Precio en catálogo compartido
**Recomendación**: flag `show_price` por `CatalogShare`; el precio mostrado es el `list_price` del ítem. Listas de precios por relación en v1.1.

### OD-20 — Personas físicas, organización unipersonal, verificación
**Contexto**: el portal exige organización; un cliente puede ser una persona.
**Opciones**: (a) MVP solo organizaciones (una persona crea su org unipersonal); (b) tipo `INDIVIDUAL` con UX simplificada.
**Recomendación**: (a) con UX "crea tu organización en 1 paso" en el portal. Verificación de organizaciones (R-01): v1.1; en MVP `is_discoverable=false` por defecto.

### OD-21 — Separación de funciones
**Recomendación**: `requester_can_self_approve=false` por defecto, configurable. Confirmar si además Compras no debe poder aprobar (no lo asumo).

### 🔴 OD-22 — Modelo de API keys y alcance ERP
> ✅ **DECIDIDO (2026-09-23):** opción **a**; API keys con roles del mismo RBAC.

**Opciones**: (a) API key con roles (mismo RBAC), actor de auditoría = la key; (b) API key ligada a un usuario "de servicio" con membership; (c) OAuth2 client credentials.
**Recomendación**: (a) en MVP (más simple, mismo policy engine). Alcance ERP según API.md §11. ¿El ERP debe poder **actualizar** requisiciones (p. ej. cambiar cantidad antes de aprobar)? Recomiendo no en MVP.

### OD-23 — Devoluciones e incidencias
**Opciones**: (a) fuera de MVP: discrepancias quedan registradas en la recepción y se resuelven por conversación + nueva entrega; (b) mini-flujo `Incident` (abrir/resolver/verificar) sin devoluciones ni reposiciones formales.
**Recomendación**: (a). Enums y campos reservados ya están en el modelo.

### OD-24 — `RESOLVED` vs `CLOSED`
**Opciones**: (a) `CLOSED` = cierre administrativo manual o automático a N días, congela conversaciones y adjuntos; (b) eliminar `CLOSED` y quedarse con `RESOLVED`.
**Recomendación**: (a) con `auto_close_days_after_resolved` (default 30). Si no ves valor, (b) simplifica.

### OD-25 — Idioma, zona horaria
**Recomendación**: UI y emails en es-MX; scaffolding i18n desde el inicio; timezone por organización (default `America/Mazatlan` para Los Cabos — confirmar) y por usuario.

### OD-26 — Autenticación: MFA / SSO
**Recomendación**: MVP email + contraseña + verificación; MFA TOTP opcional en v1.1; SSO (Google/Microsoft) v1.1. Diseño de `User` no lo impide.

### OD-27 — Retención y límites
**Propuesta**: adjuntos ≤ 25 MB por archivo, 20 por recurso; auditoría retención indefinida; eventos outbox 90 días; webhook deliveries 30 días; idempotency keys 24 h. Confirmar.

### OD-28 — Duplicate vs Reorder
**Propuesta**: **Duplicate** = copia como DRAFT sin vínculo especial (solo `derived_from` informativo), para editar libremente. **Reorder** = copia como DRAFT con `derived_from` + `directed/suggested_supplier` = proveedor de la orden original + cantidades/precios estimados tomados de la **orden** (no de la requisición original). Si la relación con ese proveedor ya no está ACTIVE, se crea sin proveedor y se avisa.

### OD-29 — Nombre de evento `quotation.received` → `quotation.submitted`
**Recomendación**: nombrar por el hecho, no por la perspectiva. Si prefieres mantener `quotation.received`, se puede exponer como alias en webhooks.

### OD-30 — Cancelación de requisición (faltante)
**Propuesta**: solicitante cancela las propias hasta `APPROVED` inclusive; Compras/Admin (`requisition.cancel`) hasta `SENT` sin orden viva; con orden viva, primero cancelar la orden. Motivo obligatorio.

### OD-31 — Edición/cancelación de entrega antes de recepción
**Propuesta**: el proveedor puede editar y cancelar una entrega `REGISTERED` hasta que el comprador confirme; cada cambio notifica al comprador y queda auditado.

### OD-32 — Modo de decisión por nivel de aprobación
**Propuesta**: `ANY_ONE` (cualquiera de los aprobadores resueltos) por defecto; `ALL` disponible. Sin quórum numérico en MVP.

### OD-33 — `split` de requisición (derivada de OD-03)
Si aceptas (c) en OD-03: ¿la requisición hija hereda la aprobación o vuelve a aprobarse? Recomiendo heredar (mismos conceptos ya aprobados), auditado.

### 🔴 OD-34 — Trabajos asíncronos en Vercel + Supabase (derivada de OD-01)
> ✅ **DECIDIDO (2026-09-23):** opción **c** — Inngest.

**Contexto**: el diseño usa un outbox de eventos y workers (notificaciones, email, webhooks con reintentos, expiración de cotizaciones, auto-cierre). Vercel es serverless: no hay procesos largos residentes.
**Opciones**: (a) **Supabase `pg_cron` + `pg_net`**: un job cada minuto despacha el outbox desde la BD y llama a un Route Handler de Next.js (`/api/internal/dispatch`) protegido con secreto; los webhooks salientes se envían desde ese handler; (b) **Vercel Cron** invocando el mismo handler; (c) cola gestionada (Inngest / Trigger.dev / Upstash QStash) con reintentos y observabilidad incluidos; (d) Supabase Edge Functions disparadas por Database Webhooks.
**Recomendación**: (c) **Inngest** (o Trigger.dev) por reintentos, backoff, idempotencia y visibilidad sin construirlos; si prefieres cero dependencias extra, (a)+(b) es viable pero hay que implementar reintentos a mano. Jobs programados (expiración, auto-cierre): Vercel Cron.
**Bloquea**: arquitectura backend (no el esquema).

### 🔴 OD-35 — Autenticación: Supabase Auth vs propia
> ✅ **DECIDIDO (2026-09-23):** opción **a** — Supabase Auth.

**Opciones**: (a) **Supabase Auth** (email+password, verificación, reset, y en v1.1 Google/Microsoft y MFA TOTP sin código propio); `User` de Procura = perfil 1:1 con `auth.users`; (b) auth propia (Auth.js/Lucia) usando Supabase solo como BD.
**Recomendación**: (a). La sesión lleva el `membership_id` activo en `app_metadata` (o en cookie firmada) y cambiar de organización re-emite el token.
**Bloquea**: tablas `users`/`memberships`, middleware.

### 🔴 OD-36 — Acceso a datos y RLS con Supabase
> ✅ **DECIDIDO (2026-09-23):** opción **a** — policy engine en Route Handlers + RLS como segunda barrera; ORM Drizzle, migraciones Drizzle Kit.

**Contexto**: la autorización de Procura (scopes, perspectivas, state machines, no-escalación) es más rica de lo que RLS expresa cómodamente. Hay que decidir dónde vive la verdad.
**Opciones**: (a) **Backend = Route Handlers de Next.js con policy engine en aplicación**, acceso a Postgres con *service role* (o rol `procura_app`) y **RLS como segunda barrera** basada en `app.organization_id` (`SET LOCAL` por transacción) — la UI nunca habla con Supabase directamente salvo Storage/Realtime; (b) UI consulta Supabase con el JWT del usuario y toda la autorización va en RLS (policies complejas, difícil de testear, imposible expresar perspectivas y no-escalación); (c) híbrido: lecturas simples por RLS, escrituras por API.
**Recomendación**: (a). Mantiene una sola API `/api/v1` para UI y ERP (principio 8), tests de autorización en un solo sitio, y RLS protege ante bugs. ORM: **Drizzle** (SQL explícito, RLS-friendly) o Prisma; recomiendo Drizzle. Migraciones con Supabase CLI o Drizzle Kit — decidir uno.
**Bloquea**: arquitectura backend y estructura del esquema (roles de BD, políticas).

### 🔴 OD-37 — ORM: Drizzle vs Prisma
**Contexto**: el blueprint recomendó Drizzle (OD-36), pero `papillon-erp` —el ERP del propio usuario que integrará con Procura— está en **Prisma** (`@prisma/client` + `@prisma/adapter-pg`). Mantener un solo ORM entre ambos proyectos reduce fricción.
**Opciones**: (a) **Prisma** con `adapter-pg`: mismo stack que el ERP; `prisma db pull` introspecta `db/schema.sql`; RLS se maneja con `SET LOCAL` en `$transaction` (interactive transactions); (b) Drizzle: SQL más explícito, `SET LOCAL` natural, menor tamaño en serverless.
**Recomendación**: (a) **Prisma**, por consistencia con el ERP y porque el equipo ya lo domina. La segunda barrera RLS funciona igual: cada request abre `$transaction(async tx => { await tx.$executeRaw`SET LOCAL app.organization_id = ${org}`; … })`.
**Bloquea**: arquitectura backend.

---

## Parte 3 — Supuestos usados en los documentos (confirmar o corregir)

| # | Supuesto | Doc |
|---|---|---|
| S-01 | La requisición es **interna**; el proveedor solo ve la RFQ (proyección). | PRODUCT_OVERVIEW §6 |
| S-02 | Una RFQ por (requisición, proveedor); la conversación compartida cuelga de la RFQ. | DOMAIN_MODEL §9, §12 |
| S-03 | La orden se construye desde la **cotización aceptada** (líneas, precios, sustituciones), no desde la requisición. | DOMAIN_MODEL §10 |
| S-04 | Cantidades rechazadas en recepción **no** reabren la línea de la orden; la reposición es post-MVP. | WORKFLOWS §5 nota |
| S-05 | Registrar una entrega sobre una orden CONFIRMED la pasa a IN_PROCESS automáticamente (H-09). | WORKFLOWS §6 |
| S-06 | Los roles base se **instancian por organización** (editables), no son globales de solo lectura. | RBAC §1 |
| S-07 | Permisos efectivos = unión de asignaciones; sin permisos negativos. | RBAC §1 |
| S-08 | Un actor no puede asignar roles con más permisos de los que tiene (no-escalación). | RBAC §5 |
| S-09 | `404` en vez de `403` para recursos de otra organización. | RBAC §6 |
| S-10 | Los ERPs pueden usar webhooks **o** el feed `GET /events`. | API §11 |
| S-11 | La comparación side-by-side puede mostrar el desvío vs presupuesto/estimado (solo al comprador). | WORKFLOWS §4 |
| S-12 | `Department.head_membership_id` se añadiría solo si se usa `approver_type=DEPARTMENT_HEAD`. | WORKFLOWS §2 |
| S-13 | La expiración de cotizaciones y el auto-cierre son jobs programados diarios. | WORKFLOWS §4, OD-24 |
| S-14 | `Requisition.requester_membership_id` es nulo cuando el origen es API; el actor de auditoría es la API key. | DOMAIN_MODEL §7 |

---

## Cómo cerrar esto

Responde por número (`OD-01: a`, `OD-03: c, split en MVP`, `S-05: no`, …). Todas las 🔴 están resueltas (OD-01/02/03/10/12/16/22/34/35/36). Faltan las de flujo y configuración (OD-04…OD-33, S-04, S-05); si no hay respuesta se aplica la recomendación ★. **Database schema** puede arrancar.
