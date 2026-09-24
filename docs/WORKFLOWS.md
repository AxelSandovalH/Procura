# PROCURA — Workflows y State Machines

> Estados, transiciones, precondiciones y efectos para cada entidad del flujo principal.
> Principio: **pocos estados; las acciones se derivan de estado + permiso + scope + workflow.**
> Referencias `OD-nn` → [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

Formato de cada transición: `estado_origen —acción→ estado_destino` · quién · precondiciones · efectos/eventos.

---

## 0. Cómo se calculan las acciones disponibles

```text
available_actions(actor, resource) =
  transitions[resource.status]
    .filter(t => can(actor, t.permission, resource))       // RBAC + scope + side
    .filter(t => t.preconditions(resource, ctx))           // reglas de negocio
    .map(t => t.action)
```

La API devuelve `available_actions: ["submit", "cancel"]` en cada recurso. El frontend **solo** pinta; el backend vuelve a evaluar al ejecutar.

---

## 1. Requisition

### Estados
| Estado | Significado |
|---|---|
| `DRAFT` | Editable por el solicitante |
| `PENDING_APPROVAL` | En el motor de aprobación |
| `APPROVED` | Aprobada; lista para que Compras busque proveedor. Sin RFQ activas |
| `SENT` | Al menos una RFQ emitida; en proceso de cotización |
| `IN_PROCESS` | Existe una orden viva (PENDING_CONFIRMATION / CONFIRMED / IN_PROCESS) |
| `RESOLVED` | La orden se completó (recepción total o cierre corto) |
| `CLOSED` | Cierre final (manual o automático, OD-24) |
| `REJECTED` | Rechazada por aprobación. Terminal (se puede duplicar) |
| `CANCELLED` | Cancelada por solicitante/Compras/Admin. Terminal |

> Añadidos respecto al brief: `REJECTED`, `CANCELLED`. "Solicitud de cambios" **no** es estado: devuelve a `DRAFT` con la decisión registrada (ver §3).

### Transiciones
| De | Acción | A | Quién (permiso) | Precondiciones | Efectos / eventos |
|---|---|---|---|---|---|
| — | `create` | `DRAFT` | `requisition.create` | ≥0 conceptos | folio asignado · `requisition.created` |
| `DRAFT` | `update` | `DRAFT` | `requisition.update` (propia) / `update_any` | — | `version++` si cambio material |
| `DRAFT` | `submit` | `PENDING_APPROVAL` · o `APPROVED` si no aplica workflow | `requisition.submit` | ≥1 concepto; conceptos libres permitidos por settings; precio estimado si `require_estimated_price` | crea `ApprovalRequest` · `requisition.submitted` · (si sin workflow) `requisition.approved` |
| `PENDING_APPROVAL` | `approve` (último nivel) | `APPROVED` | `requisition.approve` (aprobador resuelto) | ver §3 | `requisition.approved` · si `directed_supplier_organization_id` → auto `issue_rfq` (OD-02) |
| `PENDING_APPROVAL` | `reject` | `REJECTED` | aprobador resuelto | motivo | `requisition.rejected` |
| `PENDING_APPROVAL` | `request_changes` | `DRAFT` | aprobador resuelto | comentario | ApprovalRequest → `CHANGES_REQUESTED` · `requisition.changes_requested` |
| `PENDING_APPROVAL` | `withdraw` | `DRAFT` | solicitante / `update_any` | — | ApprovalRequest → `CANCELLED` |
| `APPROVED` | `update` | `APPROVED` o `PENDING_APPROVAL` | `requisition.update_any` | según `reapproval_policy` (OD-07) | `version++` · posible nueva ApprovalRequest |
| `APPROVED` | `issue_rfq` | `SENT` | `rfq.issue` | relación ACTIVE con cada proveedor; sin conceptos `REJECTED` (si per-concept) | crea `QuotationRequest`(s) · `rfq.issued` |
| `SENT` | `issue_rfq` (más proveedores) | `SENT` | `rfq.issue` | idem | |
| `SENT` | `withdraw_rfq` (todas) | `APPROVED` | `rfq.issue` | ninguna cotización ACCEPTED | RFQs → `WITHDRAWN` |
| `SENT` | `accept_quotation` | `IN_PROCESS` | `quotation.accept` | cotización SUBMITTED y vigente; sin orden viva | crea `Order` · otras cotizaciones → `NOT_SELECTED` · RFQs sin cotizar → `CLOSED` · `quotation.accepted` · `order.created` |
| `IN_PROCESS` | *(orden rechazada o cancelada)* | `SENT` | sistema | — | la requisición **permanece abierta** (reglas 8–10). Cotizaciones `NOT_SELECTED` vigentes: OD-14 |
| `IN_PROCESS` | *(orden COMPLETED)* | `RESOLVED` | sistema | — | `requisition.completed` |
| `RESOLVED` | `close` | `CLOSED` | `requisition.close` · o auto tras N días | — | `requisition.closed` |
| `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SENT` | `cancel` | `CANCELLED` | solicitante (propia, hasta APPROVED) · `requisition.cancel` (Compras/Admin) — OD-30 | motivo; sin orden viva | RFQs → `WITHDRAWN` · ApprovalRequest → `CANCELLED` · `requisition.cancelled` |
| cualquiera | `duplicate` / `reorder` | *(nueva DRAFT)* | `requisition.create` | — | nueva requisición con `derived_from`, `origin_type` (OD-28) |

### Reglas de edición
- Editable libremente solo en `DRAFT`.
- En `APPROVED`: solo Compras (`update_any`); cambios materiales disparan `reapproval_policy`.
- En `SENT` o posterior: **inmutable**. Para cambiar, `withdraw_rfq` → `APPROVED` → editar.
- Cambio material (default, OD-07): añadir/quitar concepto, cambiar cantidad, precio estimado, presupuesto, tipo. No material: título, descripción, prioridad, adjuntos, notas.

---

## 2. Approval (ApprovalRequest)

### Estados
`PENDING` → `APPROVED` | `REJECTED` | `CHANGES_REQUESTED` | `CANCELLED` | `SUPERSEDED`

### Motor
```text
on submit(requisition):
  workflow = resolveWorkflow(org, requisition)        // applies_to; default si ninguno
  if workflow == null → APPROVED directo
  levels = workflow.rules.filter(r => r.condition matches requisition)   // monto, dpto, tipo, categoría
  if levels empty → APPROVED directo
  request = ApprovalRequest(PENDING, current_level = levels[0])
  for each level: step = ApprovalStep(PENDING, resolved_approvers = resolve(level, requisition))
     · ROLE + MATCH_REQUISITION_SCOPE → memberships con ese rol cuyo scope contiene (dpto, loc) de la requisición
     · ROLE + ANY                     → memberships con ese rol en cualquier scope
     · MEMBERSHIP                     → ese membership
     · DEPARTMENT_HEAD                → Department.head_membership_id (campo a añadir si se elige) 
     · aplicar exclusión requester si !requester_can_self_approve
     · si resolved_approvers vacío → OD-09 (bloquear vs fallback a Administrador)
  notificar aprobadores del nivel actual
```

### Decisiones
| Decisión | Efecto en step | Efecto en request | Efecto en requisición |
|---|---|---|---|
| `APPROVE` | `decision_mode=ANY_ONE`: step APPROVED · `ALL`: APPROVED cuando todos | si último nivel → APPROVED; si no → `current_level++`, notificar siguiente | APPROVED al terminar |
| `REJECT` | REJECTED | REJECTED | REJECTED |
| `REQUEST_CHANGES` | — | CHANGES_REQUESTED | DRAFT |

### Por concepto (`mode = PER_CONCEPT`, OD-08)
Cada decisión lleva `concept_id`. El step se resuelve cuando todos los conceptos tienen decisión. La requisición queda `APPROVED` si ≥1 concepto APPROVED; los `REJECTED` no entran en la RFQ. Si todos rechazados → REJECTED.

### Re-aprobación
Cambio material en `APPROVED` con `reapproval_policy`:
- `ALWAYS` → nueva ApprovalRequest completa, requisición → `PENDING_APPROVAL`.
- `IF_AMOUNT_INCREASES` (recomendado default) → solo si `estimated_total` sube o se añade concepto.
- `NEVER` → registra cambio en auditoría; sigue APPROVED.
La anterior pasa a `SUPERSEDED`.

---

## 3. QuotationRequest (RFQ) — una por proveedor

| Estado | Significado |
|---|---|
| `SENT` | Emitida; el proveedor aún no la abre |
| `VIEWED` | Algún membership del proveedor la abrió |
| `QUOTED` | Existe ≥1 cotización SUBMITTED |
| `DECLINED` | El proveedor declinó cotizar (motivo) |
| `WITHDRAWN` | El comprador la retiró |
| `CLOSED` | Cerrada por el sistema al aceptar otra cotización / cancelar requisición |

| De | Acción | A | Quién | Efectos |
|---|---|---|---|---|
| `SENT` | *(lectura)* | `VIEWED` | proveedor `rfq.read` | `rfq.viewed` (solo notificación interna al comprador) |
| `SENT`/`VIEWED` | `decline` | `DECLINED` | `rfq.decline` | motivo · `rfq.declined` |
| `SENT`/`VIEWED`/`QUOTED` | `submit_quotation` | `QUOTED` | `quotation.submit` | ver §4 |
| `SENT`/`VIEWED`/`QUOTED` | `withdraw` | `WITHDRAWN` | `rfq.issue` | cotizaciones abiertas → `REJECTED` (motivo: RFQ retirada) |
| `QUOTED` | *(otra aceptada)* | `CLOSED` | sistema | cotizaciones → `NOT_SELECTED` |
| `SENT`/`VIEWED` | *(otra aceptada)* | `CLOSED` | sistema | `rfq.closed` |

Precondición global: `Relationship.status == ACTIVE` al emitir. Si la relación pasa a SUSPENDED después → OD-13.

---

## 4. Quotation

### Estados
| Estado | Significado |
|---|---|
| `DRAFT` | El proveedor la compone; invisible al comprador |
| `SUBMITTED` | Enviada; visible al comprador; vigente hasta `valid_until` |
| `WITHDRAWN` | El proveedor la retiró antes de decisión |
| `SUPERSEDED` | Reemplazada por una versión nueva del mismo proveedor (OD-04) |
| `EXPIRED` | `valid_until` pasó sin decisión |
| `ACCEPTED` | Aceptada por el comprador → orden creada |
| `NOT_SELECTED` | Otra cotización fue aceptada |
| `REJECTED` | Rechazada explícitamente por el comprador (motivo) |

### Transiciones
| De | Acción | A | Quién | Precondiciones | Efectos |
|---|---|---|---|---|---|
| — | `create` | `DRAFT` | `quotation.submit` | RFQ en SENT/VIEWED/QUOTED; relación ACTIVE | |
| `DRAFT` | `update` | `DRAFT` | `quotation.submit` | — | líneas: AS_REQUESTED / SUBSTITUTE / ALTERNATIVE_QUANTITY / ADDITIONAL / DECLINED |
| `DRAFT` | `submit` | `SUBMITTED` | `quotation.submit` | ≥1 línea no DECLINED; `valid_until` ≥ hoy; totales consistentes | versión anterior SUBMITTED → `SUPERSEDED` · RFQ → QUOTED · `quotation.submitted` |
| `SUBMITTED` | `withdraw` | `WITHDRAWN` | `quotation.submit` | no ACCEPTED | `quotation.withdrawn` |
| `SUBMITTED` | `revise` | *(nueva DRAFT, version+1)* | `quotation.submit` | — | al enviar, la anterior → SUPERSEDED |
| `SUBMITTED` | `accept` | `ACCEPTED` | `quotation.accept` | `valid_until ≥ hoy`; requisición en SENT; sin orden viva; aceptación **completa** (OD-05) | crea Order · demás → NOT_SELECTED · `quotation.accepted` · `order.created` |
| `SUBMITTED` | `reject` | `REJECTED` | `quotation.accept` | motivo | `quotation.rejected` |
| `SUBMITTED` | *(vence)* | `EXPIRED` | sistema (job) | — | `quotation.expired` |
| `EXPIRED` | `extend` | `SUBMITTED` | `quotation.submit` | nueva `valid_until` | |

Comparación side-by-side = lectura de todas las `SUBMITTED` (y opcionalmente EXPIRED/NOT_SELECTED) de la requisición, alineadas por `rfq_line_id`. Sin scoring.

---

## 5. Order

### Estados
| Estado | Significado |
|---|---|
| `PENDING_CONFIRMATION` | Creada automáticamente; espera al proveedor |
| `CONFIRMED` | El proveedor aceptó el compromiso |
| `REJECTED` | El proveedor la rechazó. Terminal. Requisición vuelve a SENT |
| `IN_PROCESS` | El proveedor la marcó en proceso manualmente |
| `COMPLETED` | Todas las líneas recibidas (o cierre corto) |
| `CANCELLED` | Cancelada por comprador o proveedor. Terminal. Requisición vuelve a SENT |

### Transiciones
| De | Acción | A | Quién | Precondiciones | Efectos |
|---|---|---|---|---|---|
| — | *(accept quotation)* | `PENDING_CONFIRMATION` | sistema | — | snapshot de cotización · `order.created` |
| `PENDING_CONFIRMATION` | `confirm` | `CONFIRMED` | proveedor `order.confirm` | — | `order.confirmed` |
| `PENDING_CONFIRMATION` | `reject` | `REJECTED` | proveedor `order.confirm` | motivo | requisición → SENT · cotización ACCEPTED → REJECTED(por proveedor) · `order.rejected` |
| `CONFIRMED` | `start` | `IN_PROCESS` | proveedor `order.start` | — | `order.started` |
| `CONFIRMED`/`IN_PROCESS` | `register_delivery` | *(sin cambio)* | proveedor `delivery.register` | Σ entregado ≤ cantidad | ver §6 |
| `IN_PROCESS` | *(última recepción confirmada)* | `COMPLETED` | sistema | todas las líneas `accepted+rejected == quantity`... o ver nota | `order.completed` · requisición → RESOLVED |
| `CONFIRMED`/`IN_PROCESS` | `close_short` | `COMPLETED` (`completion_mode=CLOSED_SHORT`) | comprador `order.close_short` | ≥1 recepción confirmada; motivo | `order.completed` |
| `PENDING_CONFIRMATION`/`CONFIRMED`/`IN_PROCESS` | `cancel` | `CANCELLED` | comprador `order.cancel` (Compras/Admin) · proveedor `order.cancel` | motivo obligatorio; **con entregas parciales → OD-15** | entregas REGISTERED sin recepción → CANCELLED · requisición → SENT · `order.cancelled` |
| `CONFIRMED`/`IN_PROCESS` | `update_reference` | *(sin cambio)* | cada lado | — | `buyer_reference` / `supplier_reference` |

Nota sobre `COMPLETED` automático: la orden se completa cuando para toda línea `received_quantity ≥ quantity`. Las cantidades **rechazadas** en recepción no se restan (la línea se considera atendida; la reposición es flujo de incidencias post-MVP, OD-23). Si el comprador quiere que el proveedor reponga, en MVP se maneja por conversación + nueva entrega antes de `close_short`.

---

## 6. Delivery

| Estado | Significado |
|---|---|
| `REGISTERED` | Proveedor la registró; pendiente de recepción |
| `RECEIVED` | El comprador confirmó la recepción (Receipt CONFIRMED*) |
| `CANCELLED` | Proveedor la canceló antes de la recepción (OD-31) |

| De | Acción | A | Quién | Precondiciones | Efectos |
|---|---|---|---|---|---|
| — | `register` | `REGISTERED` | proveedor `delivery.register` | orden CONFIRMED/IN_PROCESS; líneas válidas; ≥1 línea | crea Receipt PENDING · orden → IN_PROCESS si estaba CONFIRMED (automático, ver nota) · `delivery.created` |
| `REGISTERED` | `update` | `REGISTERED` | proveedor | recepción no confirmada | |
| `REGISTERED` | `cancel` | `CANCELLED` | proveedor | recepción no confirmada; motivo | `delivery.cancelled` |
| `REGISTERED` | *(receipt confirmed)* | `RECEIVED` | sistema | — | `delivery.received` |

Nota: el brief dice que el proveedor marca IN_PROCESS manualmente. Registrar una entrega sobre una orden `CONFIRMED` es una acción explícita del proveedor, por lo que se propone que **también** lleve la orden a IN_PROCESS (no contradice la regla; evita estados inconsistentes). Confirmar en revisión.

---

## 7. Receipt

| Estado | Significado |
|---|---|
| `PENDING` | Creado con la entrega; espera al comprador |
| `CONFIRMED` | Todo recibido = aceptado |
| `CONFIRMED_WITH_DISCREPANCIES` | Hay cantidades rechazadas, faltantes o excedentes |

| De | Acción | A | Quién | Precondiciones | Efectos |
|---|---|---|---|---|---|
| `PENDING` | `confirm` | `CONFIRMED` / `CONFIRMED_WITH_DISCREPANCIES` | comprador `receipt.confirm` (scope LOCATION de la entrega) | por línea: `received = accepted + rejected`, `received ≤ delivered`; discrepancia requiere tipo | Delivery → RECEIVED · actualiza `OrderLine.received/accepted_quantity` · `receipt.confirmed` · evalúa `order.completed` |

Sin transición de vuelta: una recepción confirmada es inmutable; las correcciones van por incidencias (post-MVP) o nota compartida.

---

## 8. Relationship y Membership (resumen)

### Relationship
`PENDING —accept→ ACTIVE` · `PENDING —reject→ REJECTED` · `ACTIVE —suspend→ SUSPENDED` · `SUSPENDED —reactivate→ ACTIVE` · `ACTIVE|SUSPENDED —finalize→ FINALIZED`.
Quién: la contraparte de quien inició acepta/rechaza (`relationship.accept`); cualquiera de las dos suspende/finaliza (`relationship.manage`). Efectos sobre operaciones en curso: OD-13.
Unicidad: no puede existir otra `PENDING`/`ACTIVE`/`SUSPENDED` para el mismo par (buyer, supplier). Tras `REJECTED`/`FINALIZED` se puede volver a solicitar.

### Membership
`PENDING —approve→ ACTIVE` · `PENDING —reject→ REMOVED` · `ACTIVE —suspend→ SUSPENDED` · `SUSPENDED —reactivate→ ACTIVE` · `ACTIVE|SUSPENDED —remove→ REMOVED`.
Invitación con `auto_accept=true` crea directamente `ACTIVE`. El primary admin no admite `suspend`/`remove`.

---

## 9. Sincronización entre entidades (resumen de reglas derivadas)

| Evento | Efecto en cadena |
|---|---|
| `quotation.accepted` | Order PENDING_CONFIRMATION · Requisition IN_PROCESS · otras Quotation NOT_SELECTED · RFQ restantes CLOSED |
| `order.rejected` / `order.cancelled` | Requisition SENT · Deliveries REGISTERED → CANCELLED · Compras puede re-emitir RFQ o (OD-14) aceptar otra vigente |
| `receipt.confirmed` | Delivery RECEIVED · OrderLine cantidades · si todo cubierto → Order COMPLETED → Requisition RESOLVED |
| `requisition.cancelled` | RFQ WITHDRAWN · Quotation abiertas REJECTED · ApprovalRequest CANCELLED |
| `relationship.suspended` | Bloquea nuevas RFQ/cotizaciones/órdenes; en curso → OD-13 |
| `membership.removed` | Sus RoleAssignments se desactivan; sus requisiciones DRAFT quedan reasignables por Compras |
