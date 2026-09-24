# PROCURA — API v1

> Contrato conceptual de la API REST. La UI, el portal y los ERPs consumen la **misma** API.
> Referencias `OD-nn` → [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 1. Convenciones

| Tema | Regla |
|---|---|
| Base | `https://api.procura.app/api/v1` — versión en el path. Cambios incompatibles ⇒ `/v2`; aditivos no rompen `/v1`. |
| Formato | JSON UTF-8. `Content-Type: application/json`. Fechas ISO-8601 UTC; fechas sin hora como `YYYY-MM-DD`. |
| IDs | UUID. Folios/números humanos son campos, no identificadores de ruta. |
| Dinero | `{ "amount_minor": 125000, "currency": "MXN" }` |
| Autenticación UI | Cookie de sesión `HttpOnly` (o Bearer JWT corto + refresh). |
| Autenticación integración | `Authorization: Bearer pk_live_xxx...` (API key de organización). |
| Contexto de organización | Sesión de usuario: header `X-Procura-Organization: <organization_id>` (debe ser una membership ACTIVE del usuario). API key: implícito, no se acepta el header. |
| Idempotencia | `Idempotency-Key: <uuid>` **obligatorio** en `POST` con API key; opcional en UI. Misma clave + mismo cuerpo ⇒ misma respuesta; cuerpo distinto ⇒ `422`. Retención 24 h. |
| Concurrencia | Recursos editables exponen `version`. `PATCH` y acciones aceptan `If-Match: "<version>"` ⇒ `409` si cambió. |
| Paginación | Cursor: `?limit=50&cursor=...` → `{ data: [], next_cursor }`. `limit` máx. 200. |
| Filtros | Query params planos: `?status=SENT&department_id=...&created_from=2026-01-01`. Listas con coma. |
| Orden | `?sort=-created_at,folio` |
| Expansión | `?include=concepts,attachments` (solo relaciones permitidas por endpoint). |
| Errores | RFC 9457 `application/problem+json`: `{ type, title, status, detail, errors?: [{field, code, message}], request_id }` |
| Acciones de estado | `POST /{recurso}/{id}/{acción}` con cuerpo opcional `{ reason, comment }`. Nunca `PATCH status`. |
| Acciones disponibles | Todo recurso con estado devuelve `available_actions: ["confirm","reject"]`. |
| Perspectiva | Recursos shared incluyen `perspective: "BUYER" | "SUPPLIER"` resuelta en servidor. |
| Rate limit | Headers `RateLimit-*`; `429` con `Retry-After`. |
| Webhooks | Ver [EVENTS.md](EVENTS.md). |

### Códigos HTTP
`200` ok · `201` creado · `202` aceptado (import/async) · `204` sin cuerpo · `400` malformado · `401` sin auth · `403` sin permiso sobre recurso visible · `404` no existe **o no visible para esta org** · `409` conflicto de estado/versión · `422` validación · `429` rate limit.

---

## 2. Identidad y sesión

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Crear usuario (email verificado antes de operar) |
| POST | `/auth/login` · `/auth/logout` · `/auth/refresh` | |
| POST | `/auth/password/forgot` · `/auth/password/reset` | |
| POST | `/auth/email/verify` | |
| GET | `/me` | Usuario + memberships (`[{organization, status, roles[]}]`) |
| PATCH | `/me` | Nombre, locale, timezone |
| GET | `/me/permissions` | Permisos efectivos en la org activa + scopes → la UI pinta menús |
| GET | `/me/notifications` · POST `/me/notifications/{id}/read` · POST `/me/notifications/read-all` | |

---

## 3. Organizaciones, miembros, roles

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/organizations` | (usuario autenticado) → creador = primary admin |
| GET | `/organizations/search?q=` | `relationship.request` — solo `is_discoverable` |
| GET / PATCH | `/organization` | `organization.read` / `organization.update` (la activa) |
| GET / PATCH | `/organization/settings` | `settings.manage` |
| GET / POST / PATCH | `/organization/departments[/{id}]` | `department.manage` |
| GET / POST / PATCH | `/organization/locations[/{id}]` | `location.manage` |
| GET | `/organization/members` | `member.read` |
| POST | `/organization/members/{id}/approve` · `/reject` · `/suspend` · `/reactivate` · `/remove` | `member.approve` / `member.manage` |
| POST | `/organization/members/{id}/transfer-primary-admin` | `admin.transfer_primary` |
| GET / POST / DELETE | `/organization/members/{id}/role-assignments[/{assignmentId}]` | `role.assign` |
| GET / POST / PATCH | `/organization/roles[/{id}]` | `role.read` / `role.manage` |
| GET | `/permissions` | catálogo estático |
| GET / POST / DELETE | `/organization/invitations[/{id}]` | `member.invite` / `relationship.request` |
| GET | `/invitations/{token}` | pública (autenticado): previsualiza |
| POST | `/invitations/{token}/accept` | autenticado → crea membership o relación (según `kind`) |
| POST | `/organization/memberships/request` | usuario pide unirse a una org (si `REQUEST_APPROVAL`) |
| GET | `/organization/audit-logs?resource_type=&resource_id=&actor=&from=&to=` | `audit.read` |

---

## 4. Relaciones y catálogo compartido

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/relationships?position=BUYER\|SUPPLIER&status=` | `relationship.read` |
| POST | `/relationships` `{ counterpart_organization_id, my_position: BUYER\|SUPPLIER, message }` | `relationship.request` |
| GET | `/relationships/{id}` | participantes |
| POST | `/relationships/{id}/accept` · `/reject` · `/suspend` · `/reactivate` · `/finalize` | `relationship.accept` / `relationship.manage` |
| GET / PATCH | `/relationships/{id}/terms` | `relationship.manage` (OD-13c) |
| GET / POST / PATCH / DELETE | `/relationships/{id}/contacts[/{cid}]` | `relationship.manage` (cada lado los suyos) |
| GET / POST / DELETE | `/relationships/{id}/catalog-shares[/{sid}]` | `catalog.share` (lado proveedor) |
| GET | `/relationships/{id}/shared-catalog?q=&category=` | `shared_catalog.read` (lado comprador) |

---

## 5. Catálogo propio

| Método | Ruta | Permiso |
|---|---|---|
| GET / POST / PATCH | `/catalog/items[/{id}]` | `catalog.read` / `catalog.manage` |
| GET / POST / PATCH | `/catalog/categories[/{id}]` | `catalog.manage` |
| GET / POST | `/catalog/units` | `catalog.manage` (OD-18) |
| POST | `/catalog/imports` (multipart: file) → `202 { import_id, detected_columns[], sample_rows[] }` | `catalog.import` |
| PUT | `/catalog/imports/{id}/mapping` `{ columns: { sku: "A", name: "B", ... } }` → valida → `{ summary, rows_preview }` | |
| GET | `/catalog/imports/{id}/rows?level=ERROR\|WARNING` | |
| POST | `/catalog/imports/{id}/confirm` → aplica upsert | |
| GET | `/catalog/imports/{id}` | estado y resumen |

---

## 6. Requisiciones

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/requisitions` — filtros: `folio, status, requester_id, department_id, location_id, supplier_organization_id, priority, type, origin_type, created_from/to, required_from/to, q` | `requisition.read` (scoped) / `read_all` |
| POST | `/requisitions` | `requisition.create` |
| GET | `/requisitions/{id}?include=concepts,approvals,rfqs,attachments,order` | |
| PATCH | `/requisitions/{id}` (`If-Match`) | `requisition.update` / `update_any` |
| POST / PATCH / DELETE | `/requisitions/{id}/concepts[/{cid}]` | (solo DRAFT / APPROVED según reglas) |
| POST | `/requisitions/{id}/submit` · `/withdraw` · `/cancel` · `/close` | ver WORKFLOWS §1 |
| POST | `/requisitions/{id}/approve` · `/reject` · `/request-changes` `{ comment, concept_ids? }` | `requisition.approve` (aprobador resuelto) |
| GET | `/requisitions/{id}/approvals` | historial de ApprovalRequests/steps/decisions |
| POST | `/requisitions/{id}/duplicate` · `/reorder` | `requisition.create` (OD-28) |
| POST | `/requisitions/{id}/rfqs` `{ supplier_organization_ids[], due_date, message, concept_ids? }` | `rfq.issue` |
| GET | `/requisitions/{id}/rfqs` | |
| GET | `/requisitions/{id}/quotations?status=` | `quotation.read` → base del side-by-side |
| GET | `/requisitions/{id}/comparison` | vista alineada por `rfq_line_id` (solo lectura, sin scoring) |
| GET / POST / PATCH / DELETE | `/requisition-templates[/{id}]` · POST `/requisition-templates/{id}/instantiate` | `template.manage` / `requisition.create` |
| GET | `/approvals/pending` | bandeja del aprobador |

### Ejemplo: creación desde ERP
```http
POST /api/v1/requisitions
Authorization: Bearer pk_live_papillon_...
Idempotency-Key: 5c1c1a9e-...
Content-Type: application/json

{
  "title": "Reposición aceite 20W-50 — stock mínimo",
  "priority": "HIGH",
  "required_date": "2026-10-05",
  "department_id": "…",
  "location_id": "…",
  "origin": { "system": "papillon-erp", "external_reference": "PO-REQ-88213" },
  "suggested_supplier_organization_id": "…",
  "budget_max": { "amount_minor": 4500000, "currency": "MXN" },
  "concepts": [
    {
      "concept_type": "GOOD",
      "source": "CATALOG",
      "catalog_item_id": "…",
      "quantity": 200,
      "estimated_unit_price": { "amount_minor": 18500, "currency": "MXN" },
      "location_id": "…"
    }
  ],
  "submit": true
}
```
Respuesta `201`: requisición con `folio`, `status` (`PENDING_APPROVAL` o `APPROVED`), `available_actions`.

---

## 7. RFQ y cotizaciones (lado proveedor y comprador)

| Método | Ruta | Permiso / lado |
|---|---|---|
| GET | `/rfqs?status=&buyer_organization_id=&due_from=` | `rfq.read` — proveedor: recibidas; comprador: emitidas |
| GET | `/rfqs/{id}` | participantes (marca VIEWED al proveedor) |
| POST | `/rfqs/{id}/decline` `{ reason }` | `rfq.decline` (proveedor) |
| POST | `/rfqs/{id}/withdraw` | `rfq.issue` (comprador) |
| POST | `/rfqs/{id}/quotations` | `quotation.submit` → DRAFT |
| GET | `/quotations?status=&rfq_id=` | según lado |
| GET / PATCH | `/quotations/{id}` (`If-Match`; PATCH solo DRAFT) | |
| POST / PATCH / DELETE | `/quotations/{id}/lines[/{lid}]` | proveedor, DRAFT |
| GET / PUT | `/quotations/{id}/private` | `quotation.read_private` — **solo proveedor**; 404 para comprador |
| POST | `/quotations/{id}/submit` · `/withdraw` · `/revise` · `/extend` `{ valid_until }` | `quotation.submit` |
| POST | `/quotations/{id}/accept` · `/reject` `{ reason }` | `quotation.accept` (comprador) |

### Ejemplo: aceptar cotización
```http
POST /api/v1/quotations/{id}/accept
X-Procura-Organization: <papillon>
If-Match: "3"
```
```json
{
  "quotation": { "id": "…", "status": "ACCEPTED" },
  "order": { "id": "…", "order_number": "PRC-000412", "status": "PENDING_CONFIRMATION",
             "available_actions": ["cancel"] },
  "requisition": { "id": "…", "status": "IN_PROCESS" }
}
```

---

## 8. Órdenes, entregas, recepciones

| Método | Ruta | Permiso / lado |
|---|---|---|
| GET | `/orders?status=&position=&counterpart_organization_id=&from=&to=` | `order.read` |
| GET | `/orders/{id}?include=lines,deliveries,private` | participantes; `private` devuelve solo `OrderPartyPrivate` del lado que consulta |
| PATCH | `/orders/{id}/reference` `{ reference }` | cada lado su campo |
| GET / PUT | `/orders/{id}/private` | cada lado el suyo |
| POST | `/orders/{id}/confirm` · `/reject` · `/start` | `order.confirm` / `order.start` (proveedor) |
| POST | `/orders/{id}/cancel` `{ reason }` | `order.cancel` (ambos lados) |
| POST | `/orders/{id}/close-short` `{ reason }` | `order.close_short` (comprador) |
| POST | `/orders/{id}/deliveries` `{ delivered_at, location_id?, carrier?, tracking_ref?, notes, lines: [{ order_line_id, quantity_delivered }] }` | `delivery.register` |
| GET | `/deliveries?order_id=&status=` · GET `/deliveries/{id}` | participantes |
| PATCH | `/deliveries/{id}` · POST `/deliveries/{id}/cancel` | proveedor, antes de recepción (OD-31) |
| POST | `/deliveries/{id}/receipt/confirm` `{ notes, lines: [{ delivery_line_id, quantity_received, quantity_accepted, quantity_rejected, discrepancy_type?, discrepancy_notes? }] }` | `receipt.confirm` (scope LOCATION) |
| GET | `/receipts/{id}` | participantes |

---

## 9. Colaboración y adjuntos

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/threads?anchor_type=ORDER&anchor_id=…&visibility=SHARED\|INTERNAL` | `conversation.shared.read` / `note.internal.read` |
| POST | `/threads/{id}/messages` `{ body, attachment_ids? }` | `conversation.shared.post` / `note.internal.post` |
| POST | `/attachments` (multipart: file, anchor_type, anchor_id, visibility, kind) | `attachment.upload` + acceso al ancla |
| GET | `/attachments/{id}` → metadata + `download_url` (firmada, 5 min) | acceso al ancla |
| DELETE | `/attachments/{id}` | `attachment.delete_own` y recurso mutable |

Reglas: un `Thread` se crea implícitamente al primer mensaje por (anchor, visibility). Un `Attachment` con `visibility=SHARED` sobre una requisición no es válido (la requisición es interna) → `422`; se adjunta a la RFQ.

---

## 10. Búsqueda

| Método | Ruta |
|---|---|
| GET | `/search?q=&types=requisition,order,quotation,delivery,catalog_item,organization&limit=` |

Devuelve grupos por tipo, ya filtrados por lo que el actor puede ver. Los filtros avanzados viven en cada listado (§6–8).

---

## 11. Integraciones

| Método | Ruta | Permiso |
|---|---|---|
| GET / POST / DELETE | `/organization/api-keys[/{id}]` | `api_key.manage` — el secreto se devuelve **una vez** |
| POST | `/organization/api-keys/{id}/rotate` | |
| GET / POST / PATCH / DELETE | `/organization/webhooks[/{id}]` `{ url, event_types[], is_active }` | `webhook.manage` — secreto se devuelve una vez |
| GET | `/organization/webhooks/{id}/deliveries?status=&from=` | |
| POST | `/organization/webhooks/{id}/deliveries/{did}/redeliver` | |
| POST | `/organization/webhooks/{id}/test` | envía `ping` |
| GET | `/events?since=<cursor>&types=` | **feed de eventos** por organización (pull, alternativa a webhooks para ERPs que no exponen endpoint) |

### Lo que un ERP puede hacer en MVP (OD-22)
1. `POST /requisitions` (con `submit: true` opcional).
2. `GET /requisitions/{id}` y `GET /requisitions?external_reference=`.
3. Recibir webhooks o consultar `GET /events`.
4. `GET /orders`, `GET /orders/{id}`.
5. `GET /deliveries`, `GET /receipts/{id}`.
6. `POST /requisitions/{id}/cancel` (mientras no exista orden viva).
No en MVP: editar requisiciones vía API, aprobar vía API, actuar como proveedor vía API (posible en v1.1 con los mismos endpoints).

---

## 12. Portal

| Método | Ruta | Auth |
|---|---|---|
| GET | `/portal/{slug}` | pública — nombre, logo, `portal_welcome_text`, si acepta solicitudes |
| POST | `/portal/{slug}/join` | autenticado + org activa → crea relación (`PENDING` o `ACTIVE` según política / invitación) |
| → | después: `POST /requisitions` con `directed_supplier_organization_id = org del portal` | flujo normal (OD-02) |

Si el usuario no tiene organización, la UI le lleva a `POST /organizations` primero (OD-20).

---

## 13. Recursos: forma de respuesta (referencia rápida)

```jsonc
// Requisition (perspectiva única: dueño)
{
  "id": "…", "folio": "REQ-00150", "status": "SENT", "version": 4,
  "requisition_type": "GOODS", "title": "…", "priority": "HIGH",
  "required_date": "2026-10-05",
  "requester": { "membership_id": "…", "name": "…" } | null,
  "department": {…}, "location": {…},
  "origin": { "type": "API", "system": "papillon-erp", "external_reference": "PO-REQ-88213" },
  "budget_max": {…},                   // solo con requisition.read_private
  "estimated_total": {…},              // idem
  "concepts": [ … ],
  "order": { "id": "…", "status": "…" } | null,
  "available_actions": ["withdraw_rfq", "cancel"],
  "created_at": "…", "updated_at": "…"
}

// Order (perspectiva)
{
  "id": "…", "order_number": "PRC-000412", "status": "CONFIRMED", "version": 2,
  "perspective": "SUPPLIER",
  "buyer_organization": { "id": "…", "display_name": "Papillon" },
  "supplier_organization": { "id": "…", "display_name": "Avocabo" },
  "my_reference": "SO-2231", "counterpart_reference": "PO-9981",
  "currency": "MXN", "subtotal": {…}, "tax": {…}, "total": {…},
  "lines": [ { "id": "…", "name": "…", "quantity": 200, "delivered_quantity": 120, "received_quantity": 120, "accepted_quantity": 118 } ],
  "private": { … },                    // solo el lado propio, si se pidió include=private
  "available_actions": ["start", "register_delivery", "cancel"]
}
```
