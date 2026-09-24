# PROCURA — Product Overview

> Blueprint funcional y técnico del MVP. Versión de análisis — pendiente de revisión conjunta.
> Las decisiones marcadas como `OPEN DECISION` se detallan en [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 1. Qué es Procura

Procura es una plataforma B2B de **procurement e interoperabilidad entre organizaciones**.
Resuelve dos problemas a la vez:

1. **Procurement interno de una organización**: crear requisiciones, aprobarlas, cotizar con proveedores, ordenar, recibir.
2. **Capa de interoperabilidad**: el mismo flujo puede originarse desde un sistema externo (ERP) vía API y cruzar la frontera entre dos organizaciones (comprador ↔ proveedor) sin que ninguna exponga su información interna.

```text
Papillon ERP ──API──▶ Procura ──▶ Requisición ──▶ Aprobación ──▶ Proveedor ──▶ Cotización ──▶ Orden ──▶ Entrega ──▶ Recepción
```

Procura **no** es: un ERP, un sistema de facturación, un procesador de pagos, un gestor documental ni un marketplace público.

---

## 2. Actores

| Actor | Qué es | Notas |
|---|---|---|
| **User** | Persona con identidad global (email) | Nunca se confunde con una organización |
| **Organization** | Empresa/entidad independiente | Tenant lógico. Dueña de sus datos internos |
| **Membership** | Pertenencia de un User a una Organization | Aprobada por la organización. Porta roles y scopes |
| **Relationship** | Vínculo comercial comprador → proveedor entre dos organizaciones | Debe estar `ACTIVE` para operar |
| **Integration principal** | API key de una organización (ERP, sistema externo) | Actúa como la organización, con permisos propios |

Un usuario trabaja siempre bajo una **organización activa**. Todo permiso, vista y acción se evalúa en ese contexto.

**Comprador** y **Proveedor** no son tipos de organización ni roles globales: son **posiciones dentro de una relación**. Papillon puede ser comprador frente a Avocabo y proveedor frente a otra empresa.

---

## 3. Flujo principal del MVP (el corazón)

```text
 ┌──────────────┐  Solicitante / ERP crea. Conceptos de catálogo o libres.
 │ REQUISICIÓN  │  Interna a la org compradora.
 └──────┬───────┘
        ▼
 ┌──────────────┐  Motor configurable: niveles, reglas, rechazo, cambios.
 │  APROBACIÓN  │  Interna a la org compradora.
 └──────┬───────┘
        ▼
 ┌──────────────┐  Compras elige proveedores (relación ACTIVE) y emite RFQ.
 │  PROVEEDOR   │  Aquí cruza la frontera: el proveedor ve una proyección
 └──────┬───────┘  compartida (RFQ), nunca la requisición interna.
        ▼
 ┌──────────────┐  Proveedor cotiza (líneas, sustituciones, vigencia).
 │  COTIZACIÓN  │  Compras compara side-by-side y acepta UNA.
 └──────┬───────┘
        ▼
 ┌──────────────┐  Se crea automáticamente al aceptar. Proveedor confirma
 │    ORDEN     │  o rechaza; luego la marca IN_PROCESS. Cancelable, nunca
 └──────┬───────┘  borrable.
        ▼
 ┌──────────────┐  Proveedor registra entregas (parciales permitidas).
 │   ENTREGA    │
 └──────┬───────┘
        ▼
 ┌──────────────┐  Comprador confirma cantidades recibidas/aceptadas,
 │  RECEPCIÓN   │  discrepancias y evidencia.
 └──────────────┘
```

### Quién hace qué

| Paso | Lado | Actor típico | Permiso clave |
|---|---|---|---|
| Crear requisición | Comprador | Solicitante, ERP | `requisition.create` |
| Aprobar | Comprador | Aprobador(es) según reglas | `requisition.approve` |
| Emitir RFQ | Comprador | Compras | `rfq.issue` |
| Cotizar | Proveedor | Ventas del proveedor | `quotation.submit` |
| Aceptar cotización | Comprador | Compras | `quotation.accept` |
| Confirmar/rechazar orden | Proveedor | Ventas/Operaciones | `order.confirm` |
| Marcar IN_PROCESS | Proveedor | Operaciones | `order.start` |
| Cancelar orden | Ambos | Compras, Administrador, Proveedor | `order.cancel` |
| Registrar entrega | Proveedor | Logística | `delivery.register` |
| Confirmar recepción | Comprador | Almacén / sucursal destino | `receipt.confirm` |

---

## 4. Arquitectura funcional — módulos

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                              PORTAL / UI                                │
├─────────────────────────────────────────────────────────────────────────┤
│                           API v1  (REST, versionada)                    │
├───────────────┬───────────────┬───────────────┬─────────────────────────┤
│ Identity &    │ Organizations │ RBAC          │ Relationships           │
│ Access        │ · settings    │ · roles       │ · buyer→supplier        │
│ · users       │ · departments │ · permissions │ · terms & contacts      │
│ · memberships │ · locations   │ · scopes      │ · catalog shares        │
│ · invitations │               │ · policy eng. │ · invitations           │
├───────────────┼───────────────┼───────────────┼─────────────────────────┤
│ Catalog       │ Requisitions  │ Approvals     │ Sourcing                │
│ · items       │ · concepts    │ · workflows   │ · RFQ                   │
│ · categories  │ · templates   │ · rules       │ · quotations            │
│ · import      │ · duplicate   │ · requests    │ · comparison            │
│               │ · reorder     │ · decisions   │                         │
├───────────────┼───────────────┼───────────────┼─────────────────────────┤
│ Orders        │ Fulfillment   │ Collaboration │ Notifications           │
│ · confirm     │ · deliveries  │ · shared conv.│ · in-app                │
│ · cancel      │ · receipts    │ · internal    │ · email                 │
│               │ · (returns,   │   notes       │                         │
│               │   incidents)* │ · attachments │                         │
├───────────────┴───────────────┴───────────────┴─────────────────────────┤
│ Cross-cutting: Event Bus (outbox) · Webhooks · API keys · Audit · Search │
└─────────────────────────────────────────────────────────────────────────┘
        * modelado, fuera del flujo principal del MVP
```

### Descripción por módulo

| Módulo | Responsabilidad | Entidades principales |
|---|---|---|
| **Identity & Access** | Registro, login, sesiones, memberships e invitaciones a organizaciones | User, Membership, Invitation |
| **Organizations** | Ficha de la organización, configuración, departamentos y localizaciones | Organization, OrganizationSettings, Department, Location |
| **RBAC** | Roles (base y personalizados), permisos, scopes, asignaciones; motor de autorización server-side | Role, Permission, RoleAssignment |
| **Relationships** | Búsqueda de organizaciones, solicitud/invitación, aceptación, configuración comercial, contactos, catálogo compartido | Relationship, RelationshipTerms, RelationshipContact, CatalogShare |
| **Catalog** | Catálogo propio por organización, categorías, unidades, importación CSV/XLSX con mapeo y preview | CatalogItem, Category, UnitOfMeasure, CatalogImport |
| **Requisitions** | Ciclo de vida de la requisición y sus conceptos; plantillas; duplicar/reordenar | Requisition, RequisitionConcept, RequisitionTemplate |
| **Approvals** | Motor de aprobación configurable: niveles, reglas, decisiones, re-aprobación | ApprovalWorkflow, ApprovalRule, ApprovalRequest, ApprovalStep, ApprovalDecision |
| **Sourcing** | Emisión de RFQ a proveedores, recepción de cotizaciones, comparación side-by-side, aceptación | QuotationRequest, Quotation, QuotationLine |
| **Orders** | Orden generada desde la cotización aceptada; confirmación, rechazo, progreso, cancelación | Order, OrderLine, OrderPartyPrivate |
| **Fulfillment** | Entregas del proveedor y recepciones del comprador; entregas parciales, discrepancias, evidencia | Delivery, DeliveryLine, Receipt, ReceiptLine |
| **Collaboration** | Conversación compartida entre organizaciones; notas internas; adjuntos con control de acceso | Thread, Message, Attachment |
| **Notifications** | Notificaciones in-app y email por eventos | Notification |
| **Events & Integrations** | Bus de eventos de dominio (outbox), webhooks firmados, API keys | DomainEvent, WebhookEndpoint, WebhookDelivery, ApiKey |
| **Audit** | Registro inmutable de acciones relevantes | AuditLog |
| **Search** | Búsqueda global + filtros por módulo | (índice sobre entidades) |
| **Portal** | Entrada pública por organización (`procura.app/{slug}/solicitar`), siempre con login | (usa Identity, Relationships, Requisitions) |

---

## 5. Principios de arquitectura (no negociables)

1. **User ≠ Organization.** Un usuario pertenece a N organizaciones; cada organización aprueba sus memberships.
2. **Private by default.** Toda entidad tiene un dueño (organización) o es explícitamente compartida entre participantes de una relación. Ver §6.
3. **Autorización server-side.** El frontend solo oculta; el backend decide. Cada request se evalúa contra actor + permiso + scope + estado del recurso.
4. **Estados vs acciones.** Pocos estados; las acciones disponibles se derivan de estado + permisos + scope + workflow.
5. **Una requisición → una orden.** Aceptar una cotización crea la orden. Varios proveedores ⇒ varias requisiciones.
6. **Nada se borra.** Cancelar, rechazar y cerrar son estados con motivo, actor, fecha y auditoría.
7. **Event-driven internamente.** Toda transición relevante emite un evento de dominio que alimenta notificaciones, webhooks, auditoría y búsqueda desde una sola fuente.
8. **API versionada desde el día uno.** `/api/v1/...`. ERP y UI usan la misma API.
9. **Relaciones aceptadas antes de operar.** Ninguna RFQ, cotización u orden sin relación `ACTIVE`.

---

## 6. Modelo interno vs compartido (la idea central)

La frontera entre organizaciones se modela con **dos tipos de entidad**, no con flags en el frontend:

| Tipo | Dueño | Quién la ve | Ejemplos |
|---|---|---|---|
| **Internal** | Una organización | Solo memberships de esa org (según permisos/scope) | Requisition, ApprovalRequest, InternalNote, OrganizationSettings, Catalog |
| **Shared** | La relación (dos orgs) | Ambas orgs, cada una con su **perspectiva** | QuotationRequest (RFQ), Quotation, Order, Delivery, Receipt, SharedConversation |
| **Party-private side** | Una de las dos orgs sobre una entidad shared | Solo esa org | QuotationSupplierPrivate (costo, margen, empleado asignado), OrderBuyerPrivate (cost center, notas) |

Consecuencia clave: **el proveedor nunca ve la Requisición**. Ve la **RFQ**, que es una proyección con solo los campos compartidos (producto, cantidad, fecha requerida, especificaciones, ubicación de entrega). Presupuesto máximo, aprobadores y notas internas viven en la requisición y jamás cruzan.

```text
 ORG COMPRADORA (internal)         RELACIÓN (shared)              ORG PROVEEDORA (internal)
 ───────────────────────────       ─────────────────────          ─────────────────────────
 Requisition ──proyección──▶ QuotationRequest (RFQ)
   · budget_max (privado)            · conceptos compartidos
   · approvers (privado)             · fecha requerida
   · internal notes                  · ubicación entrega
                                          │
                                     Quotation ◀──────────── QuotationSupplierPrivate
                                       · líneas, precios                · costo interno
                                       · vigencia, términos             · margen
                                          │                             · empleado asignado
 OrderBuyerPrivate ─────────────▶ Order ◀───────────────── OrderSupplierPrivate
   · cost center                       · líneas, total                 · proveedor interno
   · notas internas                    · estado compartido             · notas internas
                                          │
                                     Delivery / Receipt
```

---

## 7. Vista lógica de capas

```text
┌──────────────────────────────────────────────────────────────┐
│ Clients: Web UI · Portal · ERP (API key) · Webhook consumers │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ API layer  (/api/v1)                                          │
│  · AuthN (session/JWT · API key)                              │
│  · Org context resolution (active organization)               │
│  · Validation · Idempotency · Rate limit                      │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Application services (use cases)                              │
│  · Policy engine: can(actor, permission, resource)            │
│  · State machines (transiciones + precondiciones)             │
│  · Perspective serializers (buyer view / supplier view)       │
│  · Escriben entidad + DomainEvent en la MISMA transacción     │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Persistence  (PostgreSQL en Supabase — OD-01 ✅)               │
│  · organization_id en toda tabla interna                      │
│  · buyer_organization_id + supplier_organization_id en shared │
│  · outbox table para eventos                                  │
└───────────────┬──────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Async workers (consumen outbox)                               │
│  · Notifications (in-app)  · Email  · Webhooks (retry/HMAC)   │
│  · Audit projection        · Search index                     │
└──────────────────────────────────────────────────────────────┘
```

### Stack (OD-01 ✅ 2026-09-23)

| Capa | Elección | Notas |
|---|---|---|
| Frontend + API | **Next.js** (App Router, Route Handlers para `/api/v1`) | Una sola app; la UI consume la misma API que el ERP |
| Hosting | **Vercel** | Serverless; jobs programados vía Inngest cron |
| Base de datos | **PostgreSQL en Supabase** | Acceso solo desde el backend (OD-36 ✅); RLS como segunda barrera; ORM **Drizzle** |
| Auth | **Supabase Auth** (OD-35 ✅) | Perfil `users` 1:1 con `auth.users`; membership activo en el token |
| Archivos | Supabase Storage | URLs firmadas; bucket privado por organización |
| Async / webhooks | **Inngest** (OD-34 ✅) | Dispatcher del outbox, reintentos, cron |
| Email | Proveedor transaccional (Resend / Postmark / SES) | Plantillas por evento |

---

## 8. Dos orígenes, un mismo flujo

| Origen | Cómo entra | Particularidades |
|---|---|---|
| **Manual (UI)** | Solicitante crea en Procura | Puede usar plantilla, duplicar o reordenar |
| **API / ERP** | `POST /api/v1/requisitions` con API key de la org | `origin_system`, `external_reference`, `Idempotency-Key`; el actor de auditoría es la integración |
| **Portal** | Usuario externo entra por `procura.app/{slug}/solicitar` | Login obligatorio → org del usuario → relación con la org del portal (auto o aprobada) → requisición **dirigida** a esa org (OPEN DECISION OD-02) |

Los tres convergen en la misma entidad `Requisition` y el mismo motor de aprobación de la organización que la crea.

---

## 9. Fuera del producto (para no perderlo de vista)

Facturación · pagos · negociación formal · scoring/recomendación automática · búsqueda con IA · gestión documental avanzada · recurrencia automática de requisiciones · jerarquía Grupo/Empresa · workflows específicos por relación · conversión multi-moneda · motor fiscal.

Detalle completo en [MVP_SCOPE.md](MVP_SCOPE.md).

---

## 10. Glosario

| Término | Definición |
|---|---|
| **Requisición** | Solicitud interna de bienes/servicios de una organización. Nunca visible a terceros. |
| **Concepto** | Línea de una requisición (bien o servicio), de catálogo o libre. |
| **RFQ (QuotationRequest)** | Proyección compartida de una requisición enviada a **un** proveedor. Una requisición puede tener N RFQ. |
| **Cotización** | Respuesta de un proveedor a una RFQ. Puede proponer sustituciones. |
| **Orden** | Compromiso generado al aceptar una cotización. Compartida entre ambas organizaciones. |
| **Entrega** | Registro del proveedor de lo que envió/ejecutó (puede ser parcial). |
| **Recepción** | Confirmación del comprador de lo recibido/aceptado por entrega. |
| **Relación** | Vínculo comercial direccional comprador → proveedor entre dos organizaciones. |
| **Scope** | Ámbito sobre el que aplica un rol asignado (org, departamento, localización, ...). |
| **Perspectiva** | Vista de una entidad compartida desde el lado comprador o proveedor. |
| **Directed requisition** | Requisición creada ya apuntando a un proveedor concreto (flujo portal). |
