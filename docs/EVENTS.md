# PROCURA — Eventos, Notificaciones, Webhooks y Auditoría

> Un solo bus de eventos de dominio alimenta notificaciones in-app, email, webhooks, auditoría y búsqueda.
> Referencias `OD-nn` → [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 1. Arquitectura

```text
  Application service
  ┌────────────────────────────────────────────────┐
  │ BEGIN                                          │
  │   UPDATE order SET status='CONFIRMED' ...      │
  │   INSERT INTO domain_events (...)   ← outbox   │
  │   INSERT INTO audit_logs (...)                 │
  │ COMMIT                                         │
  └────────────────────────────────────────────────┘
                     │  (poll / LISTEN-NOTIFY)
                     ▼
  Event dispatcher  ──▶  Notification worker  → notifications (in-app)  → email worker
                    ──▶  Webhook worker       → webhook_deliveries (retry, HMAC)
                    ──▶  Search indexer
                    ──▶  Derived-state handlers (ej. order.completed → requisition RESOLVED)*
```
\* Las transiciones derivadas críticas (requisición ↔ orden) se ejecutan **en la misma transacción** del evento origen; el bus solo notifica. Así nunca hay ventana de inconsistencia entre estados.

Garantías: **at-least-once** hacia consumidores; cada evento lleva `id` para deduplicar. Orden por agregado garantizado (secuencia por `aggregate_id`); orden global no garantizado.

---

## 2. Envelope del evento

```jsonc
{
  "id": "evt_01J9…",                     // uuid v7, dedupe
  "type": "order.confirmed",
  "version": 1,                          // versión del esquema de payload
  "occurred_at": "2026-09-22T18:04:11Z",
  "aggregate": { "type": "order", "id": "…" },
  "actor": { "type": "USER", "membership_id": "…", "organization_id": "…" }, // o API_KEY / SYSTEM
  "organization_id": "…",                // ← organización RECEPTORA (perspectiva); un evento de dominio
                                         //    genera un envelope por organización participante
  "perspective": "BUYER",                // BUYER | SUPPLIER | OWNER (recursos internos)
  "data": { … }                          // payload filtrado por perspectiva
}
```

Regla de oro: **el payload se construye por organización receptora** con el mismo serializer de perspectiva que la API. Los campos privados de la contraparte no pueden aparecer porque no existen en la vista.

---

## 3. Catálogo de eventos (MVP)

Columnas: **Rec.** = organizaciones que reciben el evento · **N** = notificación in-app · **E** = email · **W** = disponible para webhook.

### Requisición (interno, receptor = organización dueña)
| Evento | Rec. | N | E | W | A quién se notifica |
|---|---|---|---|---|---|
| `requisition.created` | owner | – | – | ✅ | — (ERP puede querer confirmar folio) |
| `requisition.submitted` | owner | ✅ | ✅ | ✅ | aprobadores resueltos del nivel 1 |
| `requisition.approval_step_advanced` | owner | ✅ | ✅ | – | aprobadores del siguiente nivel |
| `requisition.approved` | owner | ✅ | ✅ | ✅ | solicitante, Compras |
| `requisition.rejected` | owner | ✅ | ✅ | ✅ | solicitante |
| `requisition.changes_requested` | owner | ✅ | ✅ | – | solicitante |
| `requisition.cancelled` | owner | ✅ | – | ✅ | solicitante, Compras, aprobadores pendientes |
| `requisition.completed` | owner | ✅ | ✅ | ✅ | solicitante, Compras |
| `requisition.closed` | owner | – | – | ✅ | — |

### RFQ (shared)
| Evento | Rec. | N | E | W | A quién |
|---|---|---|---|---|---|
| `rfq.issued` | both | ✅ | ✅ | ✅ | proveedor: miembros con `rfq.read` (o scope RELATIONSHIP futuro) |
| `rfq.viewed` | buyer | ✅ | – | – | Compras |
| `rfq.declined` | both | ✅ | ✅ | ✅ | Compras |
| `rfq.withdrawn` | both | ✅ | ✅ | ✅ | proveedor |
| `rfq.closed` | both | ✅ | – | ✅ | proveedor (no seleccionado) |

### Cotización (shared)
| Evento | Rec. | N | E | W | A quién |
|---|---|---|---|---|---|
| `quotation.submitted` *(≈ `quotation.received` del brief, OD-29)* | both | ✅ | ✅ | ✅ | Compras |
| `quotation.withdrawn` | both | ✅ | – | ✅ | Compras |
| `quotation.expired` | both | ✅ | – | ✅ | Compras, proveedor |
| `quotation.accepted` | both | ✅ | ✅ | ✅ | proveedor, solicitante |
| `quotation.rejected` | both | ✅ | ✅ | ✅ | proveedor |
| `quotation.not_selected` | both | ✅ | – | ✅ | proveedor |

### Orden (shared)
| Evento | Rec. | N | E | W | A quién |
|---|---|---|---|---|---|
| `order.created` | both | ✅ | ✅ | ✅ | proveedor (`order.confirm`), Compras |
| `order.confirmed` | both | ✅ | ✅ | ✅ | Compras, solicitante |
| `order.rejected` | both | ✅ | ✅ | ✅ | Compras, solicitante |
| `order.started` | both | ✅ | – | ✅ | Compras |
| `order.cancelled` | both | ✅ | ✅ | ✅ | contraparte, solicitante |
| `order.completed` | both | ✅ | ✅ | ✅ | ambos |

### Entrega / Recepción (shared)
| Evento | Rec. | N | E | W | A quién |
|---|---|---|---|---|---|
| `delivery.created` | both | ✅ | ✅ | ✅ | comprador: `receipt.confirm` en la LOCATION |
| `delivery.updated` | both | ✅ | – | ✅ | idem |
| `delivery.cancelled` | both | ✅ | ✅ | ✅ | idem |
| `receipt.confirmed` | both | ✅ | ✅ | ✅ | proveedor; Compras si discrepancias |

### Relaciones y organización (interno / shared)
| Evento | Rec. | N | E | W |
|---|---|---|---|---|
| `relationship.requested` · `accepted` · `rejected` · `suspended` · `reactivated` · `finalized` | both | ✅ | ✅ | ✅ |
| `membership.requested` · `approved` · `rejected` · `suspended` · `removed` · `primary_admin_transferred` | owner | ✅ | ✅ | – |
| `invitation.created` · `accepted` · `revoked` | owner | ✅ | ✅(al invitado) | – |
| `catalog.import_completed` · `catalog.share_updated` | owner / both | ✅ | – | – |
| `message.posted` (thread SHARED) | both | ✅ | – | ✅ |
| `note.posted` (thread INTERNAL) | owner | ✅ | – | – |
| `webhook.ping` | owner | – | – | ✅ |

> Los nombres son estables: `recurso.hecho_en_pasado`. Añadir eventos es aditivo; renombrar exige `version` nueva.

---

## 4. Payloads conceptuales

```jsonc
// requisition.approved  (perspective OWNER)
"data": {
  "requisition": { "id", "folio", "status": "APPROVED", "version", "title", "requisition_type",
                   "required_date", "department": {…}, "location": {…},
                   "origin": { "type", "system", "external_reference" },
                   "estimated_total": {…} },          // interno: sí viaja al dueño
  "approval": { "request_id", "levels_completed": 2, "decisions": [ { "membership_id", "decision", "at" } ] }
}

// rfq.issued  (perspective SUPPLIER)  ← nota: NO hay requisition_id, ni budget, ni estimated price
"data": {
  "rfq": { "id", "rfq_number", "status", "due_date", "required_date", "message",
           "buyer_organization": { "id", "display_name" },
           "delivery_locations": [ … ],
           "lines": [ { "id", "line_number", "name", "description", "specifications", "quantity", "unit_label", "required_date", "delivery_location" } ] }
}

// quotation.submitted  (perspective BUYER)
"data": {
  "quotation": { "id", "quotation_number", "version", "status", "rfq_id", "requisition_id",   // requisition_id SOLO en perspectiva BUYER
                 "supplier_organization": {…}, "currency", "subtotal", "tax", "total", "valid_until",
                 "lead_time_days", "payment_terms", "delivery_terms",
                 "lines": [ { "id", "rfq_line_id", "line_kind", "name", "quantity", "unit_price", "line_total" } ] }
}

// order.confirmed  (ambas perspectivas; difieren en my_reference / counterpart_reference y en requisition_id)
"data": {
  "order": { "id", "order_number", "status", "version", "perspective",
             "requisition_id"?,              // solo BUYER
             "buyer_organization", "supplier_organization",
             "my_reference", "counterpart_reference",
             "currency", "total", "required_date",
             "lines": [ { "id", "name", "quantity", "unit_price", "delivery_location" } ] },
  "confirmed_at": "…"
}

// receipt.confirmed  (ambas)
"data": {
  "receipt": { "id", "status", "delivery_id", "order_id", "confirmed_at",
               "lines": [ { "delivery_line_id", "order_line_id", "quantity_received", "quantity_accepted", "quantity_rejected", "discrepancy_type", "discrepancy_notes" } ] },
  "order": { "id", "status", "lines_summary": [ { "order_line_id", "quantity", "received_quantity", "accepted_quantity" } ] }
}
```

---

## 5. Notificaciones

| Aspecto | Regla |
|---|---|
| Destinatarios | Se resuelven **por permiso + scope** (ej. `receipt.confirm` con scope LOCATION de la entrega), más actores explícitos (solicitante, aprobadores resueltos, `assigned_membership_id`). |
| In-app | Una fila `Notification` por membership. Agrupación en UI por recurso. `read_at`. |
| Email | Solo eventos marcados **E**. Plantilla por evento, idioma del usuario (OD-25). Digest/preferencias por usuario: fuera de MVP. |
| Enlace | Cada notificación apunta a la ruta del recurso en la perspectiva correcta. |
| Silencio | Actor que ejecuta la acción no se notifica a sí mismo. |

---

## 6. Webhooks

| Aspecto | Regla |
|---|---|
| Registro | Por organización: `url` (HTTPS obligatorio), `event_types[]` (o `*`), secreto generado por Procura, `is_active`. |
| Entrega | `POST url` con el envelope de §2. Headers: `Procura-Event-Id`, `Procura-Event-Type`, `Procura-Timestamp`, `Procura-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. |
| Verificación | Receptor recalcula HMAC; rechaza si `|now − timestamp| > 5 min` (anti-replay). |
| Reintentos | Éxito = 2xx en ≤ 10 s. Fallo → backoff exponencial: 1m, 5m, 30m, 2h, 6h, 24h (6 intentos). Luego `FAILED`; redelivery manual desde UI/API. |
| Desactivación | 50 fallos consecutivos ⇒ endpoint `is_active=false` + notificación al admin. |
| Orden | No garantizado entre eventos distintos; usar `occurred_at` + estado en el payload, o re-leer el recurso vía API. |
| Idempotencia | Receptor deduplica por `Procura-Event-Id`. |
| Perspectiva | Un endpoint solo recibe envelopes cuya `organization_id` es la suya. |
| Feed alternativo | `GET /api/v1/events?since=` para ERPs sin endpoint público (mismo envelope, cursor). |
| Payload mínimo (opción) | Configurable por endpoint: `full` (default) o `thin` (`{id,type,aggregate}` y el receptor consulta la API). |

---

## 7. Auditoría (I)

### Qué se registra (mínimo obligatorio)
| Categoría | Acciones |
|---|---|
| **Flujo** | `requisition.created/submitted/approved/rejected/changes_requested/cancelled/closed/updated(material)` · `rfq.issued/withdrawn/declined` · `quotation.submitted/withdrawn/accepted/rejected/expired` · `order.created/confirmed/rejected/started/cancelled/completed/close_short` · `delivery.created/updated/cancelled` · `receipt.confirmed` |
| **Administración** | `member.*`, `role.created/updated`, `role_assignment.granted/revoked`, `primary_admin.transferred`, `settings.updated`, `approval_workflow.updated`, `api_key.created/rotated/revoked`, `webhook.created/updated/deleted`, `invitation.created/revoked` |
| **Relaciones** | `relationship.*`, `relationship_terms.updated`, `catalog_share.created/removed` |
| **Datos** | `catalog.import_confirmed` (resumen), `catalog_item.created/updated` (solo vía API/import, no cada tecla de UI), `attachment.uploaded/deleted` |
| **Seguridad** | `auth.login_succeeded/failed`, `auth.password_reset`, `auth.email_verified`, `session.organization_switched`, `authz.denied` (muestreado) |

### Estructura de `AuditLog`
| Campo | Contenido |
|---|---|
| `occurred_at` | UTC |
| `actor_type`, `actor_id`, `membership_id?`, `api_key_id?` | quién |
| `organization_id` | contexto en que actuó |
| `visible_to_organization_ids[]` | dueño (interno) o ambos participantes (shared) — cada uno ve la entrada desde su perspectiva |
| `action` | `order.cancelled` |
| `resource_type`, `resource_id`, `resource_label` | `order`, uuid, `PRC-000412` |
| `changes` | JSON diff `{ field: { from, to } }` — **filtrado por perspectiva** al leer |
| `reason` | motivo cuando la acción lo exige |
| `metadata` | `request_id`, `ip`, `user_agent`, `idempotency_key`, `event_id` |

### Propiedades
- **Append-only**: sin UPDATE/DELETE (permiso de BD restringido; opcional: hash encadenado por organización).
- **Misma transacción** que la mutación: si falla la auditoría, falla la acción.
- **Consulta**: `GET /organization/audit-logs` con `audit.read`; filtros por recurso, actor, acción, rango. Vista "historial" embebida en cada recurso (subset).
- **Retención**: OD-27 (recomendado: indefinida en MVP; exportación CSV).
- **PII**: se guarda `membership_id`, no email; la resolución a nombre ocurre al leer.

---

## 8. Relación evento ↔ auditoría ↔ notificación (resumen)

| | AuditLog | DomainEvent | Notification | Webhook |
|---|---|---|---|---|
| Propósito | Quién hizo qué (cumplimiento) | Hecho de negocio (integración) | Avisar a personas | Avisar a sistemas |
| Escritura | Misma transacción | Misma transacción (outbox) | Async desde evento | Async desde evento |
| Contiene diff | ✅ | ❌ (estado resultante) | ❌ | ❌ |
| Incluye acciones admin/seguridad | ✅ | parcial | parcial | ❌ (MVP) |
