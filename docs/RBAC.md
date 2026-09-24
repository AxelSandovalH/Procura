# PROCURA — RBAC, Scopes y Autorización Server-Side

> Roles, permisos, scopes, administración delegada y diseño del motor de autorización.
> Referencias `OD-nn` → [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 1. Modelo

```text
User
 └─ Membership (User @ Organization, status ACTIVE)
      └─ RoleAssignment[]  (Role @ Scope)
            └─ Role ─< Permission[]
```

- Los **permisos** son un catálogo fijo en código (`resource.action`).
- Los **roles** son conjuntos de permisos, por organización. Los roles base se instancian al crear la organización y son editables.
- Una **asignación** liga un membership a un rol dentro de un **scope**. Sin scope = toda la organización.
- Un membership puede tener varias asignaciones; los permisos efectivos son la **unión** (no hay permisos negativos en MVP).
- Las **API keys** son principales que también portan roles (OD-22): reutilizan exactamente este modelo.

---

## 2. Catálogo de permisos

`side` indica desde qué posición de una relación tiene sentido el permiso. `ANY` = no depende de la relación.

### Organización y administración
| Código | Descripción | side |
|---|---|---|
| `organization.read` | Ver ficha y configuración | ANY |
| `organization.update` | Editar ficha | ANY |
| `settings.manage` | Editar OrganizationSettings | ANY |
| `department.manage` | CRUD departamentos | ANY |
| `location.manage` | CRUD localizaciones | ANY |
| `member.read` | Ver miembros | ANY |
| `member.invite` | Crear invitaciones de membership | ANY |
| `member.approve` | Aprobar/rechazar solicitudes de membership | ANY |
| `member.manage` | Suspender/remover miembros | ANY |
| `role.read` | Ver roles y permisos | ANY |
| `role.manage` | Crear/editar roles | ANY |
| `role.assign` | Asignar/revocar roles y scopes | ANY |
| `admin.transfer_primary` | Transferir administrador principal | ANY |
| `audit.read` | Consultar bitácora | ANY |
| `api_key.manage` | Crear/revocar API keys | ANY |
| `webhook.manage` | CRUD endpoints de webhook | ANY |
| `approval_workflow.manage` | Configurar motor de aprobación | ANY |

### Relaciones y catálogo
| Código | Descripción | side |
|---|---|---|
| `relationship.read` | Ver relaciones | ANY |
| `relationship.request` | Buscar orgs, solicitar relación, crear invitaciones de relación | ANY |
| `relationship.accept` | Aceptar/rechazar solicitudes | ANY |
| `relationship.manage` | Suspender/reactivar/finalizar; editar términos y contactos | ANY |
| `catalog.read` | Ver catálogo propio | ANY |
| `catalog.manage` | CRUD ítems, categorías, unidades | ANY |
| `catalog.import` | Importar CSV/XLSX | ANY |
| `catalog.share` | Compartir ítems con relaciones | SUPPLIER |
| `shared_catalog.read` | Consultar catálogos compartidos por proveedores | BUYER |

### Requisiciones y aprobación (lado comprador)
| Código | Descripción |
|---|---|
| `requisition.read` | Ver requisiciones (dentro del scope) |
| `requisition.read_all` | Ver todas las de la organización (ignora scope de dpto/loc) |
| `requisition.create` | Crear (manual, plantilla, duplicar, reordenar, API) |
| `requisition.update` | Editar propias en DRAFT |
| `requisition.update_any` | Editar ajenas (Compras) |
| `requisition.submit` | Enviar a aprobación |
| `requisition.cancel` | Cancelar (OD-30) |
| `requisition.close` | Cerrar administrativamente |
| `requisition.approve` | Aprobar / rechazar / solicitar cambios cuando se es aprobador resuelto |
| `requisition.read_private` | Ver presupuesto máximo y precios estimados |
| `template.manage` | CRUD plantillas |

### Sourcing y órdenes (lado comprador)
| Código | Descripción |
|---|---|
| `rfq.issue` | Emitir RFQ a proveedores; retirar RFQ |
| `quotation.read` | Ver cotizaciones recibidas / comparar |
| `quotation.accept` | Aceptar (genera orden) o rechazar cotizaciones |
| `order.read` | Ver órdenes |
| `order.cancel` | Cancelar orden (Compras, Administrador, y proveedor por su lado) |
| `order.close_short` | Cerrar orden con cantidades pendientes (OD-15) |
| `receipt.confirm` | Confirmar recepción de una entrega |

### Sourcing y órdenes (lado proveedor)
| Código | Descripción |
|---|---|
| `rfq.read` | Ver RFQ recibidas |
| `rfq.decline` | Declinar cotizar |
| `quotation.submit` | Crear/editar/enviar/retirar cotizaciones |
| `quotation.read_private` | Ver/editar QuotationSupplierPrivate (costo, margen) |
| `order.confirm` | Confirmar o rechazar orden |
| `order.start` | Marcar IN_PROCESS |
| `delivery.register` | Registrar/editar/cancelar entregas |

### Colaboración y archivos
| Código | Descripción |
|---|---|
| `conversation.shared.read` | Leer conversaciones compartidas |
| `conversation.shared.post` | Escribir en conversaciones compartidas |
| `note.internal.read` | Leer notas internas |
| `note.internal.post` | Escribir notas internas |
| `attachment.upload` | Subir adjuntos a recursos accesibles |
| `attachment.delete_own` | Eliminar adjuntos propios antes de que el recurso quede inmutable |

### Notificaciones y búsqueda
| Código | Descripción |
|---|---|
| `notification.read` | (implícito para todo membership ACTIVE) |
| `search.global` | (implícito; el índice ya filtra por lo que el actor puede ver) |

> Permisos independientes de conversación compartida vs notas internas — requisito §21 del brief.

---

## 3. Roles base (instanciados por organización, editables)

| Rol | Permisos (resumen) | Comentario |
|---|---|---|
| **Administrador** | Todos los `ANY` + todos los de ambos lados | El primary admin lo tiene siempre, a nivel organización |
| **Solicitante** | `requisition.read/create/update/submit/cancel`, `template.manage`, `catalog.read`, `shared_catalog.read`, `note.internal.*`, `attachment.upload`, `order.read`, `receipt.confirm` (scoped) | Ve solo lo propio y de su scope |
| **Compras** | Solicitante + `requisition.read_all/update_any/read_private/close`, `rfq.issue`, `quotation.read/accept`, `order.read/cancel/close_short`, `relationship.request/read`, `conversation.shared.*` | Decide proveedor |
| **Aprobador** | `requisition.read` (scoped), `requisition.approve`, `requisition.read_private`, `note.internal.*` | Normalmente asignado con scope DEPARTMENT o LOCATION |
| **Finanzas** | `requisition.read_all/read_private`, `order.read`, `audit.read`, `approval_workflow.manage` | Sin acciones de flujo en MVP (facturación fuera) |
| **Proveedor** (posición) | `rfq.read/decline`, `quotation.submit/read_private`, `order.read/confirm/start/cancel`, `delivery.register`, `conversation.shared.*`, `note.internal.*`, `catalog.read/share`, `relationship.read/accept` | Es un **rol-plantilla** con permisos side=SUPPLIER. Una org lo asigna a quien atiende clientes |
| **Cliente** (posición) | `requisition.create/read/update/submit/cancel`, `quotation.read/accept`, `order.read`, `receipt.confirm`, `conversation.shared.*` | Rol-plantilla para orgs que entran por portal; equivale a "Solicitante + Compras mínimo" en una org pequeña |

**Por qué Proveedor/Cliente no son roles globales:** los permisos `side=SUPPLIER` solo se activan sobre recursos donde `ctx.organization == resource.supplier_organization_id`; los `side=BUYER` donde es `buyer_organization_id`. Una misma org puede tener miembros con ambos roles.

---

## 4. Scopes

### Tipos
| scope_type | MVP | Aplica a | Ejemplo |
|---|---|---|---|
| `ORGANIZATION` | ✅ | Todo | Administrador |
| `DEPARTMENT` | ✅ | Requisition (header) | Aprobador de "Compras" |
| `LOCATION` | ✅ | Requisition (header), Delivery/Receipt (location) | Recepción en "San José del Cabo" |
| `RELATIONSHIP` | ⏭ reservado | RFQ, Quotation, Order | Ejecutivo de cuenta de un solo cliente |
| `CATEGORY` | ⏭ reservado | Concept, CatalogItem | Comprador de "Refacciones" |
| `COST_CENTER` | ⏭ reservado | Requisition | Futuro |
| `OPERATION_TYPE` | ⏭ reservado | Requisition (GOODS/SERVICE) | Aprobador solo de servicios |

Extensible: añadir un scope = añadir un valor al enum + una función `resourceScopeAttributes()` para los recursos afectados. Sin migraciones de esquema.

### Atributos de scope por recurso (MVP)
| Recurso | `department_id` | `location_id` | `relationship_id` |
|---|---|---|---|
| Requisition | header | header | — |
| RequisitionConcept | hereda | propio → **OD-11** | — |
| RFQ / Quotation / Order | (vía requisición, solo lado comprador) | — | sí |
| Delivery / Receipt | — | location de la entrega | sí |

### Algoritmo de evaluación

```text
can(actor, permission, resource?) :
  1. membership = actor.membership  (ACTIVE)  ─ o ApiKey activa
  2. assignments = membership.roleAssignments
                   .filter(a => a.role.permissions ∋ permission)
     if empty → DENY
  3. if resource is null (acción de creación/listado) → ALLOW  (el listado filtra después)
  4. side check:
       permission.side == BUYER    → require ctx.org == resource.buyer_organization_id
       permission.side == SUPPLIER → require ctx.org == resource.supplier_organization_id
       permission.side == ANY      → require ctx.org == resource.organization_id
                                     (o ∈ {buyer, supplier} si resource es shared)
     fail → DENY (404 hacia afuera)
  5. scope check:  ALLOW si ∃ assignment tal que
       scope_type == ORGANIZATION
       ∨ (scope_type == DEPARTMENT ∧ resource.department_id == scope_id)
       ∨ (scope_type == LOCATION   ∧ resource.location_id   == scope_id)
       ∨ ...
     else → DENY
  6. state check (delegado a la state machine): la acción existe desde resource.status
  7. business rules: ej. requester_can_self_approve, relación ACTIVE, aprobador resuelto
```

Los listados aplican el mismo predicado como filtro SQL (`WHERE organization_id = ? AND (department_id IN (...) OR location_id IN (...) OR <org-wide>)`).

### Casos especiales
- **Propietario del recurso**: `requisition.update` sobre requisiciones propias en DRAFT no necesita scope de departamento — el solicitante siempre ve las suyas (`requester_membership_id == ctx.membership`).
- **Aprobador resuelto**: `requisition.approve` solo procede si el membership está en `ApprovalStep.resolved_approver_membership_ids` del paso actual. Tener el permiso no basta.
- **Separación de funciones**: si `settings.requester_can_self_approve = false`, el solicitante no puede decidir sobre su propia requisición aunque sea aprobador resuelto (OD-21).

---

## 5. Administración

| Regla | Detalle |
|---|---|
| **Primary admin** | Uno por organización (`Membership.is_primary_admin`). Se asigna al creador de la org. Solo él puede `admin.transfer_primary`. No puede ser removido, suspendido ni perder el rol Administrador. |
| **Administración delegada** | Cualquier membership con `role.assign`, `member.manage`, etc. Los permisos administrativos son granulares para poder delegar solo "gestionar miembros" sin "gestionar roles". |
| **No escalación** | Un actor solo puede asignar roles cuyo conjunto de permisos sea ⊆ de sus propios permisos efectivos (evita que un delegado se auto-otorgue Administrador). |
| **Auditoría obligatoria** | Toda acción de: `role.manage`, `role.assign`, `member.*`, `admin.transfer_primary`, `settings.manage`, `api_key.manage`, `webhook.manage`, `approval_workflow.manage`, `relationship.manage`, `catalog.share`. Ver [EVENTS.md](EVENTS.md) §5. |
| **Roles del sistema** | Los roles base instanciados llevan `is_system=true`; se pueden editar permisos pero no eliminar (para que la UI siempre pueda sugerirlos). |

---

## 6. Seguridad: autorización server-side (H)

### Principios
1. **Deny by default.** Todo endpoint declara el permiso requerido; un endpoint sin declaración falla en CI.
2. **Un solo punto de decisión** (`PolicyService.can`). Ni controladores ni serializers contienen lógica `if role == ...`.
3. **La perspectiva es parte de la autorización.** Un recurso shared se serializa con `perspective = BUYER | SUPPLIER` resuelta en backend, nunca elegida por el cliente.
4. **404 sobre 403** para recursos de otra organización (no revelar existencia). 403 solo cuando el recurso es visible pero la acción no está permitida.
5. **Las state machines validan en servidor**; el cliente solo recibe `available_actions[]` para pintar botones.
6. **Los campos privados no viajan**: viven en tablas separadas (ver DOMAIN_MODEL §14), así que ningún serializer puede "olvidar" quitarlos.

### Controles concretos
| Área | Control |
|---|---|
| Autenticación UI | Sesión con cookie `HttpOnly; Secure; SameSite=Lax` o JWT corto + refresh rotativo. CSRF token si cookie. |
| Autenticación API | `Authorization: Bearer <api_key>`. Hash Argon2/SHA-256 en BD; prefijo visible; rotación y revocación; `expires_at` opcional. |
| Contexto de org | Derivado de `membership_id` en la sesión o de la API key. Header `X-Procura-Organization` solo para **elegir** entre memberships del usuario; se valida contra membership ACTIVE. |
| Password | Argon2id; política mínima; verificación de email obligatoria antes de operar; reset con token de un solo uso. MFA/SSO: OD-26. |
| Rate limiting | Por IP en auth; por API key en API; por membership en UI. |
| Validación | Esquemas estrictos por endpoint; rechazo de campos desconocidos (anti mass-assignment). Los campos privados se aceptan solo en endpoints del lado dueño. |
| Idempotencia | `Idempotency-Key` obligatorio en POST de creación vía API key. |
| Concurrencia | `If-Match: <version>` en PATCH/acciones de estado → 409 en conflicto. |
| Adjuntos | Validación de MIME real (magic bytes), límite de tamaño (OD-27), URL firmada 5 min, nunca servido desde el dominio principal. Antivirus: fuera de MVP (riesgo R-06). |
| Webhooks | Firma HMAC-SHA256 con secreto por endpoint, timestamp anti-replay, solo HTTPS, payload por perspectiva. |
| Búsqueda | El índice guarda `organization_ids[]`; toda query lleva el filtro del actor. |
| Logs | Nunca loguear secretos, tokens, ni cuerpos con datos privados. `request_id` correlacionado con AuditLog. |
| Enumeración | UUID v7; los slugs de organización son públicos por diseño (portal). |
| Invitaciones | Token aleatorio ≥ 128 bits, expiración, `max_uses`, revocable, auditado. |
| Tests obligatorios | Por endpoint: (a) sin permiso → 403/404; (b) org ajena → 404; (c) perspectiva contraria no ve campos privados; (d) transición inválida → 409. |

---

## 7. Ejemplos

**Juan Pérez** — Papillon: Compras (scope ORGANIZATION) · ABC Servicios: Administrador.

| Acción | Contexto activo | Resultado |
|---|---|---|
| Emitir RFQ de REQ-00150 (Papillon) | Papillon | ✅ `rfq.issue`, org coincide |
| Emitir RFQ de REQ-00150 | ABC Servicios | ❌ 404 — la requisición no pertenece a ABC |
| Aprobar REQ-00150 | Papillon | ❌ 403 — Compras no tiene `requisition.approve` |
| Ver cotización de Avocabo a REQ-00150 | Papillon | ✅ perspectiva BUYER; no ve `QuotationSupplierPrivate` |

**María** — Papillon: Aprobador (scope DEPARTMENT = Operaciones) + Solicitante.

| Acción | Resultado |
|---|---|
| Aprobar requisición de Operaciones donde es aprobadora resuelta | ✅ |
| Aprobar requisición de Administración | ❌ scope |
| Aprobar su propia requisición de Operaciones | ❌ si `requester_can_self_approve=false` |
| Ver `budget_max` de una requisición de Operaciones | ✅ (`requisition.read_private` en Aprobador) |
