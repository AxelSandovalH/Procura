# PROCURA — Database Schema

> Guía del esquema en [`db/schema.sql`](../db/schema.sql) (v0.1, 2026-09-24). Validado en PostgreSQL 17 con smoke tests de invariantes y RLS.
> Fuente de diseño: [DOMAIN_MODEL.md](DOMAIN_MODEL.md) · decisiones en [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

---

## 1. Cómo aplicarlo

Proyecto Supabase: **DelPacifico / Procura** (`bmbfheansyswcjnwgbqr`, us-west-2). Está vacío: `schema.sql` es la migración inicial.

```bash
# Opción A — Supabase CLI (recomendada: queda registrada como migración)
supabase link --project-ref bmbfheansyswcjnwgbqr
mkdir -p supabase/migrations && cp db/schema.sql supabase/migrations/20260924000000_init.sql
supabase db push
```

Opción B — pegar `db/schema.sql` en el SQL Editor del dashboard y ejecutar (una sola transacción).

Después, **una sola vez y desde el dashboard** (no en el repo):

```sql
alter role procura_app password '<contraseña-fuerte>';
```

y guardar en Vercel la variable `DATABASE_URL` con el usuario `procura_app` (pooler en modo *transaction*, puerto 6543). `SUPABASE_SERVICE_ROLE_KEY` solo para Inngest/migraciones.

> Vercel: fijar la región de funciones en **`pdx1`** (Oregón) para estar junto a la base.

---

## 2. Decisiones que el esquema materializa

| Decisión | Cómo se ve en el SQL |
|---|---|
| OD-35 Supabase Auth | `users.id → auth.users(id)`; trigger `on_auth_user_created` crea el perfil |
| OD-36 backend + RLS | Rol `procura_app` (`NOBYPASSRLS`); `SET LOCAL app.organization_id / app.user_id` por transacción; `anon`/`authenticated` sin grants |
| OD-02 dirigida vs sugerida | `requisitions.suggested_supplier_organization_id` y `directed_supplier_organization_id` |
| OD-03 split | `requisitions.parent_requisition_id`, `requisition_origin = 'SPLIT'` |
| OD-10 departamentos por org | `departments.organization_id`; requisición lleva `department_id` + `location_id` |
| OD-12 relación direccional | `relationships_one_live_per_pair (buyer, supplier) where status in (PENDING, ACTIVE, SUSPENDED)` |
| OD-16 numeración | `order_number` global `PRC-000001` (secuencia) + `buyer_reference` / `supplier_reference`; `RFQ-`, `QT-` igual; folio de requisición por org vía `app.next_sequence()` |
| OD-22 API keys | `api_keys` + `api_key_roles`; `requisitions.origin_api_key_id` |
| OD-04 versiones de cotización | `quotations.version`, `unique (rfq_id, version)`, una `SUBMITTED` por RFQ |
| OD-08 aprobación por concepto | `approval_workflows.mode`, `requisition_concepts.approval_status`, `approval_decisions.concept_id` — modelado, sin UI |
| OD-17 impuestos | `check (subtotal_minor + tax_minor = total_minor)`; sin cálculo |
| OD-18 unidades | `units_of_measure.organization_id NULL` = global (16 semilla) |
| OD-19 precio compartido | `catalog_shares.show_price` |
| OD-21 self-approve | `organization_settings.requester_can_self_approve = false` |
| OD-23 devoluciones | `deliveries.replacement_of_return_id` reservado; enum `discrepancy_type` |
| OD-24 CLOSED | `organization_settings.auto_close_days_after_resolved` |
| OD-27 límites | `attachment_max_bytes` (25 MB), `attachment_max_per_resource` (20); `idempotency_keys.expires_at` 24 h |
| OD-32 modo de decisión | `approval_rules.decision_mode` (`ANY_ONE` default) |
| Regla 6 (1 req → 1 orden) | `orders_one_live_per_requisition where status not in (REJECTED, CANCELLED)` |
| Invariante 7 (recepción) | `check (quantity_received = quantity_accepted + quantity_rejected)` |
| Nada se borra | `check (status <> 'CANCELLED' or cancel_reason is not null)` en requisiciones, órdenes y entregas |

---

## 3. Estrategia de RLS

Tres patrones, aplicados por listas en el bloque §17 del SQL:

| Patrón | Tablas | Policy |
|---|---|---|
| **INTERNAL** | settings, departments, locations, roles, RBAC, invitations, api_keys, catálogo, requisiciones, aprobaciones, `*_private`, notifications, webhooks, events, idempotency | `organization_id = app.current_org()` |
| **SHARED** | relationships (+terms, contacts, catalog_shares), RFQ (+lines), quotations (+lines), orders (+lines), deliveries (+lines), receipts (+lines) | `app.current_org() in (buyer_organization_id, supplier_organization_id)` |
| **Mixtas** | threads, messages, attachments | según `visibility`; escritura solo desde la org autora/propietaria |

Casos especiales: `users` y `organizations` legibles por el backend (resolver nombres, búsqueda de organizaciones); `memberships` visibles también por `user_id = app.current_user_id()` (elegir organización antes de fijar contexto); `audit_logs` por `visible_to_organization_ids` y **sin UPDATE/DELETE** para `procura_app`.

**Toda tabla hija denormaliza las columnas de tenancy** (`organization_id` o `buyer/supplier_organization_id`). Cuesta 16–32 bytes por fila y evita policies con `EXISTS` sobre el padre, que son lentas y fáciles de romper.

Resultado del smoke test (ver §5): Papillon ve su requisición y no `quotation_supplier_private`; Avocabo ve RFQ/cotización/orden y su privado, **no** la requisición; sin contexto no ve nada; insert cross-org rechazado.

---

## 4. Cosas que el esquema deja a la aplicación (a propósito)

| Qué | Por qué en la app y no en la BD |
|---|---|
| Transiciones de estado y precondiciones | Viven en las state machines (WORKFLOWS.md); en BD solo constraints de consistencia |
| `order_lines.delivered/received/accepted_quantity` | La app las actualiza en la misma transacción que la entrega/recepción; sin triggers ocultos |
| `requisitions.requisition_type` y `estimated_total_minor` | Derivados al guardar conceptos |
| Asignación de `folio` | `app.next_sequence(org, 'requisition')` formateado con `requisition_folio_prefix` |
| Autorización por permiso/scope/perspectiva | Policy engine (RBAC.md §4); RLS es la segunda barrera, no la primera |
| Payload de `domain_events` | Se inserta ya filtrado por perspectiva, una fila por organización receptora |
| Hash de tokens/API keys/secretos | La BD solo guarda `*_hash` |

---

## 5. Validación local

```bash
docker run -d --name procura-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:17-alpine
# stub de auth.users + roles anon/authenticated/service_role (solo local), luego:
docker exec -i procura-pg psql -U postgres -v ON_ERROR_STOP=1 < db/schema.sql
```

Smoke test ejecutado el 2026-09-24: perfil desde `auth.users` ✅ · bootstrap de organización (settings, 7 roles, 149 permisos, admin principal) ✅ · secuencias por org ✅ · numeración global ✅ · unicidad de orden viva ✅ · `subtotal+tax=total` ✅ · RLS buyer/supplier/sin contexto ✅ · insert cross-org bloqueado ✅ · `audit_logs` append-only ✅.

---

## 6. Pendiente / siguiente paso

- **ORM**: el ERP Papillon usa **Prisma**; el blueprint recomendó Drizzle. Cualquiera de los dos puede *introspectar* este SQL (`prisma db pull` / `drizzle-kit pull`). Decidir en OD-37 antes de la arquitectura backend.
- Índices adicionales se añadirán con datos reales; los actuales cubren listados por estado, bandejas por lado y búsqueda.
