# PROCURA — Domain Model

> Entidades, relaciones, invariantes y modelo de aislamiento multi-tenant.
> Los nombres de entidad/campo están en inglés (código); la explicación en español.
> Referencias `OD-nn` → [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 0. Convenciones transversales

| Convención | Regla |
|---|---|
| Identificadores | UUID v7 (ordenable por tiempo, no enumerable). Nunca IDs secuenciales expuestos. |
| Folios humanos | Secuencia **por organización** con prefijo configurable (`REQ-00150`). Ver OD-16 para órdenes. |
| Timestamps | `created_at`, `updated_at` en todo; `*_at` para hitos de estado (`approved_at`, `confirmed_at`). UTC. |
| Dinero | Entero en unidad menor (`amount_minor`) + `currency` (ISO 4217) **en cada monto**. Sin conversión de moneda en MVP (OD-17). |
| Cantidades | `numeric(18,4)` — servicios y fracciones. |
| Borrado | Nunca físico para documentos de negocio. Estados `CANCELLED`/`REJECTED`/`CLOSED` + motivo. Catálogo y maestros: `is_active`. |
| Tenancy | Tablas **internal** llevan `organization_id`. Tablas **shared** llevan `buyer_organization_id` y `supplier_organization_id` (+ `relationship_id`). |
| Concurrencia | `version` (int) en agregados editables → `If-Match` / optimistic locking. |
| Actor | Toda mutación registra `actor_type` (`USER` \| `API_KEY` \| `SYSTEM`) + `actor_id` + `membership_id` (si aplica). |

---

## 1. Mapa de entidades

```text
IDENTITY & ORGS                  RBAC                       RELATIONSHIPS
──────────────                   ────                       ─────────────
User ─┬─< Membership >─┬─ Organization ─< Department        Relationship (buyer_org → supplier_org)
      │                │        │       ─< Location           ├─ RelationshipTerms
      │                │        │       ── OrganizationSettings├─< RelationshipContact
      │                │        └─< Role ─< RolePermission    └─< CatalogShare ─> CatalogItem
      │                └─< RoleAssignment (role, scope_type, scope_id)
      └─< Invitation (membership | relationship)

CATALOG                          REQUISITIONS                       APPROVALS
───────                          ────────────                       ─────────
Organization ─< CatalogItem      Requisition ─< RequisitionConcept  ApprovalWorkflow ─< ApprovalRule
             ─< Category             │  ├─ derived_from (self)      Requisition ─< ApprovalRequest ─< ApprovalStep ─< ApprovalDecision
             ─< UnitOfMeasure        │  └─ template_id
             ─< CatalogImport ─< CatalogImportRow

SOURCING (shared)                ORDERS (shared)                    FULFILLMENT (shared)
─────────────────                ───────────────                    ────────────────────
Requisition ─< QuotationRequest  Quotation ─1─ Order ─< OrderLine   Order ─< Delivery ─< DeliveryLine
  (RFQ, por proveedor)             │           ├─ OrderPartyPrivate(×2)     │
  ├─< QuotationRequestLine         │           └─ cancellation fields       └─1─ Receipt ─< ReceiptLine
  └─< Quotation ─< QuotationLine   │                                   (post-MVP: Return, Incident, Replacement)
        └─ QuotationSupplierPrivate

COLLABORATION                    INTEGRATION & AUDIT                NOTIFICATIONS
─────────────                    ───────────────────                ─────────────
Thread (anchor, visibility)      DomainEvent (outbox)               Notification
  └─< Message                    ApiKey                             (por membership)
Attachment (anchor, visibility)  WebhookEndpoint ─< WebhookDelivery
                                 AuditLog
```

---

## 2. Identity & Access

### User
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| email | citext, unique | Identidad global |
| email_verified_at | timestamp? | |
| password_hash | text | Argon2id. SSO/MFA fuera de MVP (OD-26) |
| full_name | text | |
| locale, timezone | text | Default `es-MX` / org timezone (OD-25) |
| status | enum | `ACTIVE` \| `SUSPENDED` |

### Membership  (User ↔ Organization)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| user_id, organization_id | uuid | unique(user_id, organization_id) |
| status | enum | `PENDING` \| `ACTIVE` \| `SUSPENDED` \| `REMOVED` |
| requested_by | enum | `USER` \| `ORGANIZATION` (invitación) |
| approved_by_membership_id | uuid? | Quién aprobó |
| is_primary_admin | bool | Exactamente uno `true` por organización (constraint parcial) |
| title | text? | Cargo mostrado |
| default_department_id, default_location_id | uuid? | Precarga en requisiciones |

Regla: el **primary admin** no puede ser removido ni suspendido; solo transferido (acción auditada).

### Invitation
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organization_id | uuid | Emisora |
| kind | enum | `MEMBERSHIP` \| `RELATIONSHIP` |
| token | text, unique | Link/código |
| email | citext? | Si es nominal |
| role_ids | uuid[] | Roles a asignar al aceptar (solo `MEMBERSHIP`) |
| relationship_position | enum? | `BUYER` \| `SUPPLIER` — posición que tomará **quien acepta** (solo `RELATIONSHIP`) |
| auto_accept | bool | Config del §22 del brief: autoacepta o requiere aprobación |
| expires_at, max_uses, used_count | | |
| status | enum | `ACTIVE` \| `EXPIRED` \| `REVOKED` |

### ApiKey  (principal de integración)
| Campo | Tipo | Notas |
|---|---|---|
| id, organization_id | uuid | |
| name | text | "Papillon ERP" |
| key_prefix | text | Visible; el secreto se muestra una sola vez |
| key_hash | text | |
| role_ids | uuid[] | Reutiliza RBAC: la key tiene roles → permisos (OD-22) |
| scope_type, scope_id | | Opcional, igual que RoleAssignment |
| last_used_at, expires_at, revoked_at | | |

---

## 3. Organizations

### Organization
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| slug | text, unique | `procura.app/{slug}/solicitar` |
| legal_name, display_name | text | |
| tax_id | text? | RFC. Sin verificación en MVP (OD-20) |
| country, base_currency, timezone | | |
| is_discoverable | bool | Aparece en búsqueda de organizaciones |
| status | enum | `ACTIVE` \| `SUSPENDED` |

### OrganizationSettings (1:1)
| Campo | Notas |
|---|---|
| requisition_folio_prefix, order_reference_prefix | `REQ-`, `PO-` |
| allow_free_concepts | Permite conceptos no de catálogo |
| require_estimated_price | Para evaluar reglas de monto (OD-09b) |
| membership_join_policy | `INVITE_ONLY` \| `REQUEST_APPROVAL` |
| relationship_request_policy | `MANUAL_APPROVAL` \| `AUTO_ACCEPT_VIA_INVITATION_ONLY` |
| requester_can_self_approve | default `false` (OD-21) |
| reapproval_policy | Ver WORKFLOWS §3.4 (OD-07) |
| auto_close_days_after_resolved | int? (OD-24) |
| portal_enabled, portal_welcome_text | |

### Department
`id, organization_id, name, code?, parent_id?, is_active`. Nivel **organización** (recomendación en OD-10).

### Location
`id, organization_id, name, code?, address (json), contact_name?, contact_phone?, is_active, is_delivery_point`.

---

## 4. RBAC

### Permission
Catálogo **estático** definido en código, no en BD editable: `code` (`requisition.create`), `module`, `description`, `side` (`BUYER` \| `SUPPLIER` \| `ANY`). Ver [RBAC.md](RBAC.md).

### Role
`id, organization_id, name, description, is_system (roles base clonados por org), is_active`.
Los roles base se **instancian por organización** al crearla; la organización puede editarlos o crear nuevos.

### RolePermission
`role_id, permission_code`.

### RoleAssignment  (Membership → Role @ Scope)
| Campo | Notas |
|---|---|
| membership_id, role_id | |
| scope_type | `ORGANIZATION` \| `DEPARTMENT` \| `LOCATION` \| *(reservados: `COST_CENTER`, `CATEGORY`, `RELATIONSHIP`, `OPERATION_TYPE`)* |
| scope_id | null cuando `ORGANIZATION` |
| granted_by_membership_id, granted_at | Auditado |

Un membership puede tener N asignaciones (mismo rol en dos departamentos, roles distintos, etc.).

---

## 5. Relationships

### Relationship  (direccional: buyer → supplier)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| buyer_organization_id, supplier_organization_id | uuid | unique(buyer, supplier) — OD-12 |
| status | enum | `PENDING` \| `ACTIVE` \| `SUSPENDED` \| `FINALIZED` \| `REJECTED` |
| initiated_by_organization_id | uuid | Cualquiera de las dos |
| initiated_via | enum | `SEARCH` \| `INVITATION` \| `PORTAL` |
| accepted_at, suspended_at, finalized_at | | + `*_by_membership_id`, `*_reason` |

### RelationshipTerms (1:1, editable por ambas — OD-13c)
`currency, payment_terms (text), default_delivery_location_ids (uuid[] del comprador), quotation_instructions (text), lead_time_days?`.

### RelationshipContact
`relationship_id, organization_id (a qué lado pertenece), membership_id? | name/email/phone, role_label, is_primary`.

### CatalogShare
`relationship_id, catalog_item_id | category_id, shared_by_organization_id (= supplier), show_price (bool, OD-19), is_active`.

---

## 6. Catalog

### CatalogItem
| Campo | Notas |
|---|---|
| id, organization_id | |
| sku | unique(organization_id, sku) |
| name, description | |
| item_type | `GOOD` \| `SERVICE` |
| unit_id | → UnitOfMeasure (OD-18) |
| list_price_minor, currency | opcional |
| category_id | opcional |
| is_active | |
| attributes | jsonb (especificaciones libres) |

### Category — `id, organization_id, name, parent_id?`
### UnitOfMeasure — `id, organization_id?, code, name` (globales semilla + propias, OD-18)

### CatalogImport
`id, organization_id, file_attachment_id, format (CSV|XLSX), status (UPLOADED|MAPPED|VALIDATED|CONFIRMED|FAILED), column_mapping (json), summary (json: total, valid, warnings, errors), created_by`.
### CatalogImportRow
`import_id, row_number, raw (json), normalized (json), level (OK|WARNING|ERROR), messages (json[]), action (CREATE|UPDATE|SKIP)`.

Regla: la importación es **upsert por SKU** dentro de la organización; nunca borra.

---

## 7. Requisitions  (INTERNAL a la org compradora)

### Requisition
| Grupo | Campo | Notas |
|---|---|---|
| Id | id, organization_id, folio | folio unique por org |
| | requisition_type | **derivado** de conceptos: `GOODS` \| `SERVICE` \| `MIXED` |
| | title, description, priority (`LOW`\|`NORMAL`\|`HIGH`\|`URGENT`) | |
| | required_date | fecha objetivo global; cada concepto puede sobreescribir |
| | status | ver WORKFLOWS §1 |
| | version | se incrementa en cada edición material; la aprobación se liga a `approved_version` |
| Origin | requester_membership_id? | null si origen API |
| | department_id?, location_id? | Header |
| | origin_type | `MANUAL` \| `API` \| `PORTAL` \| `DUPLICATE` \| `REORDER` \| `TEMPLATE` |
| | origin_system?, external_reference? | ERP |
| | derived_from_requisition_id?, template_id? | |
| Destination | suggested_supplier_organization_id? | Sugerencia del solicitante (no vinculante) |
| | directed_supplier_organization_id? | Portal / dirigida: RFQ automática (OD-02) |
| | destination_contact?, delivery_location_id? | |
| Private | budget_max_minor?, currency | **nunca** cruza a la RFQ |
| | internal_notes | vía Thread INTERNAL |
| Totals | estimated_total_minor | derivado: Σ qty × estimated_unit_price |
| Cierre | resolved_at, closed_at, cancelled_at, cancel_reason, cancelled_by | |
| | order_id? | la única orden (1:1 cuando existe) |

### RequisitionConcept
| Campo | Notas |
|---|---|
| id, requisition_id, line_number | |
| concept_type | `GOOD` \| `SERVICE` |
| source | `CATALOG` \| `SUPPLIER_CATALOG` \| `FREE` |
| catalog_item_id? | ítem propio |
| supplier_catalog_item_id? | ítem del catálogo compartido del proveedor (OD-19) |
| name, description, specifications (jsonb/text) | |
| quantity, unit_id / unit_label | |
| estimated_unit_price_minor?, currency | privado |
| budget_minor? | privado |
| required_date? | override |
| location_id? | destino del concepto (multi-ubicación) |
| approval_status | `PENDING` \| `APPROVED` \| `REJECTED` — solo si workflow por concepto (OD-08) |
| fulfilled_quantity | derivado de recepciones |

### RequisitionTemplate
`id, organization_id, name, description, payload (json snapshot de header + conceptos), created_by, is_active`.
Sin recurrencia automática (fuera de MVP).

---

## 8. Approvals  (INTERNAL)

### ApprovalWorkflow
`id, organization_id, name, is_default, is_active, applies_to (json: requisition_types?, department_ids?, location_ids?), mode (`WHOLE` | `PER_CONCEPT` — OD-08)`.

### ApprovalRule  (= nivel)
| Campo | Notas |
|---|---|
| workflow_id, level (int, orden) | Secuencial |
| condition | json: `{ min_amount_minor?, max_amount_minor?, department_ids?, requisition_types?, category_ids? }` — el nivel aplica solo si la condición se cumple |
| approver_type | `ROLE` \| `MEMBERSHIP` \| `DEPARTMENT_HEAD` |
| approver_ref | role_id / membership_id |
| approver_scope_policy | `MATCH_REQUISITION_SCOPE` (rol en el departamento/localización de la requisición) \| `ANY` |
| decision_mode | `ANY_ONE` \| `ALL` (OD-32) |

### ApprovalRequest  (instancia por requisición + versión)
`id, requisition_id, requisition_version, workflow_id, status (PENDING|APPROVED|REJECTED|CHANGES_REQUESTED|CANCELLED|SUPERSEDED), current_level, started_at, completed_at`.

### ApprovalStep
`approval_request_id, level, status (PENDING|APPROVED|REJECTED|SKIPPED), resolved_approver_membership_ids (uuid[]) — snapshot de quiénes podían aprobar`.

### ApprovalDecision
`step_id, membership_id, decision (APPROVE|REJECT|REQUEST_CHANGES), comment, concept_id? (per-concept), decided_at`.

Invariante: cuando `requisition.version` cambia con una `ApprovalRequest` en curso o aprobada, se aplica `reapproval_policy` (OD-07): la anterior pasa a `SUPERSEDED` y se crea una nueva.

---

## 9. Sourcing  (SHARED)

### QuotationRequest  (RFQ) — una por (requisición, proveedor)
| Campo | Notas |
|---|---|
| id, requisition_id | FK interna; **no** se expone al proveedor |
| relationship_id, buyer_organization_id, supplier_organization_id | |
| rfq_number | referencia visible a ambos |
| status | `SENT` \| `VIEWED` \| `QUOTED` \| `DECLINED` \| `WITHDRAWN` \| `CLOSED` |
| due_date | fecha límite para cotizar |
| message | instrucciones del comprador |
| required_date, delivery_location snapshot | copia **compartida** |
| unique(requisition_id, supplier_organization_id) | una RFQ activa por proveedor |

### QuotationRequestLine  (proyección compartida del concepto)
`rfq_id, requisition_concept_id (interno), line_number, name, description, specifications, quantity, unit_label, required_date?, delivery_location (snapshot), supplier_catalog_item_id?`.
**Excluye**: estimated_price, budget, cost center, cualquier campo privado.

### Quotation
| Campo | Notas |
|---|---|
| id, rfq_id, relationship_id, buyer_organization_id, supplier_organization_id | |
| quotation_number, version | versiones por RFQ (OD-04) |
| status | `DRAFT` \| `SUBMITTED` \| `WITHDRAWN` \| `SUPERSEDED` \| `ACCEPTED` \| `NOT_SELECTED` \| `REJECTED` \| `EXPIRED` |
| currency, subtotal_minor, tax_minor, total_minor | sin motor fiscal (OD-17) |
| valid_until | vigencia |
| lead_time_days?, delivery_terms, payment_terms, notes | |
| submitted_at, submitted_by_membership_id, accepted_at, accepted_by_membership_id | |

### QuotationLine
| Campo | Notas |
|---|---|
| quotation_id, line_number | |
| rfq_line_id? | null cuando es `ADDITIONAL` |
| line_kind | `AS_REQUESTED` \| `SUBSTITUTE` \| `ALTERNATIVE_QUANTITY` \| `ADDITIONAL` \| `DECLINED` |
| supplier_catalog_item_id?, name, description, specifications | |
| quantity, unit_label, unit_price_minor, line_total_minor | |
| lead_time_days?, notes | |

### QuotationSupplierPrivate (1:1, solo proveedor)
`quotation_id, supplier_organization_id, assigned_membership_id?, internal_cost_minor?, margin_pct?, internal_supplier_ref?, internal_notes`.

---

## 10. Orders  (SHARED)

### Order
| Campo | Notas |
|---|---|
| id, requisition_id (interno comprador), quotation_id (1:1) | |
| relationship_id, buyer_organization_id, supplier_organization_id | |
| order_number | global Procura (OD-16) |
| buyer_reference?, supplier_reference? | referencias propias de cada lado |
| status | `PENDING_CONFIRMATION` \| `CONFIRMED` \| `REJECTED` \| `IN_PROCESS` \| `COMPLETED` \| `CANCELLED` |
| currency, subtotal_minor, tax_minor, total_minor | snapshot de la cotización |
| payment_terms, delivery_terms, required_date | snapshot |
| confirmed_at/by, rejected_at/by/reason, started_at/by | |
| cancelled_at, cancelled_by_membership_id, cancelled_by_organization_id, cancel_reason | obligatorio al cancelar |
| completed_at, completion_mode | `FULL` \| `CLOSED_SHORT` (OD-15) |

### OrderLine
`order_id, line_number, quotation_line_id, requisition_concept_id?, name, description, quantity, unit_label, unit_price_minor, line_total_minor, delivery_location (snapshot), delivered_quantity, received_quantity, accepted_quantity (derivados)`.

### OrderPartyPrivate (una fila por lado)
`order_id, organization_id, cost_center_ref?, internal_notes, internal_supplier_ref?, assigned_membership_id?, custom (jsonb)`.

---

## 11. Fulfillment  (SHARED)

### Delivery  (la registra el proveedor)
| Campo | Notas |
|---|---|
| id, order_id, relationship_id, buyer/supplier_organization_id | |
| delivery_number | por orden: `#1, #2...` |
| status | `REGISTERED` \| `RECEIVED` \| `CANCELLED` (OD-31) |
| delivered_at (fecha real), location (snapshot), carrier?, tracking_ref?, notes | |
| registered_by_membership_id | |

### DeliveryLine
`delivery_id, order_line_id, quantity_delivered, notes`. Invariante: Σ delivered ≤ order_line.quantity (salvo tolerancia configurable — fuera de MVP).

### Receipt  (la confirma el comprador, 1:1 con Delivery)
| Campo | Notas |
|---|---|
| id, delivery_id, order_id | |
| status | `PENDING` \| `CONFIRMED` \| `CONFIRMED_WITH_DISCREPANCIES` |
| confirmed_at, confirmed_by_membership_id, notes | |

### ReceiptLine
`receipt_id, delivery_line_id, quantity_received, quantity_accepted, quantity_rejected, discrepancy_type? (SHORTAGE|OVERAGE|DAMAGED|WRONG_ITEM|QUALITY|OTHER), discrepancy_notes`.

Evidencia (fotos, reportes, checklists, firmas) = `Attachment` anclados a Delivery/Receipt con `kind` (`EVIDENCE`). Sin módulo de checklists en MVP.

### Post-MVP (modelado, no implementado): Return → Incident → Replacement → Delivery(replacement_of_return_id)
Ver [MVP_SCOPE.md](MVP_SCOPE.md) y OD-23.

---

## 12. Collaboration

### Thread
| Campo | Notas |
|---|---|
| id | |
| anchor_type, anchor_id | `REQUISITION` \| `REQUISITION_CONCEPT` \| `RFQ` \| `RFQ_LINE` \| `QUOTATION` \| `ORDER` \| `DELIVERY` |
| visibility | `INTERNAL` \| `SHARED` |
| organization_id | solo si `INTERNAL` |
| relationship_id | solo si `SHARED` (participantes = las dos orgs) |

Nota: una **requisición** solo admite `INTERNAL` (no es shared). La "conversación compartida sobre la requisición" existe **por RFQ** (una por proveedor). Ver hallazgo H-07.

### Message
`thread_id, author_membership_id, body, created_at, edited_at?`.

### Attachment
| Campo | Notas |
|---|---|
| id, owner_organization_id, uploaded_by_membership_id | |
| anchor_type, anchor_id | REQUISITION, CONCEPT, RFQ, QUOTATION, ORDER, DELIVERY, RECEIPT, MESSAGE, CATALOG_IMPORT |
| visibility | `INTERNAL` \| `SHARED` — heredada del ancla y explícita |
| kind | `DOCUMENT` \| `EVIDENCE` \| `IMPORT_SOURCE` |
| storage_key, filename, mime_type, size_bytes, checksum_sha256 | |

Acceso: descarga solo vía URL firmada de corta vida, tras `can(actor, 'attachment.read', attachment)` que delega en la visibilidad del ancla.

---

## 13. Notifications, Events, Audit

### Notification
`id, membership_id, event_id, type, title, body, resource_type, resource_id, read_at, emailed_at?`.

### DomainEvent (outbox)
`id, type, occurred_at, aggregate_type, aggregate_id, actor (json), organization_ids (uuid[] con perspectiva), payload (json), version, processed_at`. Ver [EVENTS.md](EVENTS.md).

### WebhookEndpoint / WebhookDelivery
`endpoint: organization_id, url, secret_hash, event_types[], is_active` · `delivery: endpoint_id, event_id, attempt, status, response_code, next_retry_at`.

### AuditLog  (inmutable, append-only)
`id, occurred_at, actor_type, actor_id, membership_id?, organization_id (contexto), visible_to_organization_ids (uuid[]), action, resource_type, resource_id, changes (json diff), metadata (ip, user_agent, request_id, api_key_id?)`.

---

## 14. Matriz interno / compartido

| Entidad | Tipo | Comprador ve | Proveedor ve |
|---|---|---|---|
| Requisition, Concept | Internal (buyer) | Todo | **Nada** |
| ApprovalRequest/Decision | Internal (buyer) | Todo | Nada |
| QuotationRequest + lines | Shared | Todo | Todo (campos compartidos ya filtrados en origen) |
| Quotation + lines | Shared | Todo | Todo |
| QuotationSupplierPrivate | Party-private (supplier) | Nada | Todo |
| Order + lines | Shared | Todo | Todo |
| OrderPartyPrivate | Party-private | La suya | La suya |
| Delivery, Receipt | Shared | Todo | Todo |
| Thread SHARED | Shared | Todo | Todo |
| Thread INTERNAL | Internal | La suya | La suya |
| Attachment | Según `visibility` | | |
| Catalog | Internal | Propio | Propio |
| CatalogShare | Shared (read) | Ítems compartidos con él | Lo que compartió |
| AuditLog | Por `visible_to_organization_ids` | Sus entradas + shared | Sus entradas + shared |

---

## 15. Multi-tenancy y aislamiento (G)

### Modelo
- **Base de datos compartida, esquema compartido, aislamiento por fila.** Recomendado para MVP: simple, permite entidades shared sin federación.
- Tres clases de tabla:
  1. **Global**: `users`, `permissions`, `units_of_measure` (semilla).
  2. **Internal**: columna `organization_id NOT NULL`. Toda consulta pasa por un repositorio que exige `organization_id = ctx.active_organization_id`.
  3. **Shared**: columnas `buyer_organization_id` y `supplier_organization_id`. Toda consulta exige `ctx.active_organization_id IN (buyer, supplier)` y el serializer aplica la **perspectiva** (`BUYER` | `SUPPLIER`).

### Defensa en profundidad
| Capa | Mecanismo |
|---|---|
| Request context | Se resuelve `active_organization_id` desde membership (UI) o desde la API key. No se acepta por query param. |
| Repositorio | Métodos `forOrganization(ctx)` / `forParticipant(ctx)`; prohibido el acceso "raw" en capa de aplicación. |
| Base de datos | **Row-Level Security** nativo de Supabase/PostgreSQL con `SET LOCAL app.organization_id` por transacción desde el backend (OD-36). Si falla la capa de aplicación, la BD no devuelve filas ajenas. La UI **no** consulta tablas directamente con el JWT del usuario. |
| Serialización | Serializers por perspectiva. Los campos privados **no existen** en la tabla shared, por lo que no hay nada que "olvidar filtrar". |
| IDs | UUID v7 — no enumerables. Acceso a un ID ajeno ⇒ 404, no 403 (no revelar existencia). |
| Adjuntos | Supabase Storage, bucket privado, clave opaca; descarga por URL firmada tras autorización en el backend. |
| Búsqueda | Índice con `organization_ids[]` como filtro obligatorio. |
| Eventos/Webhooks | Payload construido por perspectiva **por organización receptora**. |
| Tests | Suite de aislamiento: para cada endpoint, un test "org B no ve recurso de org A" y "proveedor no ve campo privado del comprador". |

### Cambio de organización activa
Cambiar de contexto = nuevo token/sesión con `membership_id`. Nunca se mezclan dos organizaciones en un mismo request.

---

## 16. Invariantes de dominio

1. Una `Requisition` tiene como máximo **una** `Order` (no cancelada/rechazada) → `unique(requisition_id) where status not in (REJECTED, CANCELLED)`.
2. Una `Quotation` `ACCEPTED` ⇒ existe exactamente una `Order` con `quotation_id`.
3. Por RFQ solo puede haber una `Quotation` en `SUBMITTED`; versiones anteriores → `SUPERSEDED`.
4. `Relationship.status = ACTIVE` es precondición de crear RFQ, Quotation, Order.
5. Membership `ACTIVE` es precondición de cualquier acción; `is_primary_admin` único por org y no removible.
6. Σ `DeliveryLine.quantity_delivered` por `order_line` ≤ `OrderLine.quantity`.
7. `ReceiptLine.quantity_accepted + quantity_rejected = quantity_received` y `quantity_received ≤ DeliveryLine.quantity_delivered`.
8. Cancelación/rechazo exige `reason`, `actor`, `timestamp`; nunca borra.
9. Campos privados (`budget_max`, `estimated_unit_price`, `QuotationSupplierPrivate.*`, `OrderPartyPrivate.*`) jamás aparecen en entidades shared ni en payloads de webhook a la contraparte.
10. `Requisition.version` incrementa en edición material; toda `ApprovalRequest` referencia la versión aprobada.
