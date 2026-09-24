# PROCURA

Plataforma B2B de **procurement e interoperabilidad entre organizaciones**: requisiciones, aprobaciones, cotizaciones, órdenes, entregas y recepciones — con una API y webhooks para que sistemas externos (ERP) originen y sigan el flujo.

```text
Requisición → Aprobación → Proveedor → Cotización → Orden → Entrega → Recepción
```

## Estado

🚧 **Fase de diseño → esquema.** Blueprint en [`docs/`](docs/); esquema inicial de base de datos en [`db/schema.sql`](db/schema.sql) (validado, pendiente de aplicar en Supabase). Sin código de aplicación todavía.

## Blueprint del MVP

| Documento | Contenido |
|---|---|
| [PRODUCT_OVERVIEW.md](docs/PRODUCT_OVERVIEW.md) | Qué es Procura, actores, flujo principal, módulos, principios, modelo interno vs compartido |
| [DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) | Entidades, campos, relaciones, invariantes, multi-tenancy y aislamiento |
| [RBAC.md](docs/RBAC.md) | Permisos, roles base, scopes, administración delegada, autorización server-side |
| [WORKFLOWS.md](docs/WORKFLOWS.md) | State machines: requisición, aprobación, RFQ, cotización, orden, entrega, recepción |
| [API.md](docs/API.md) | Convenciones y endpoints `/api/v1`, alcance para ERP, portal |
| [EVENTS.md](docs/EVENTS.md) | Bus de eventos, catálogo de eventos, notificaciones, webhooks, auditoría |
| [MVP_SCOPE.md](docs/MVP_SCOPE.md) | Qué entra, qué se modela sin implementar y qué queda fuera |
| [OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md) | Hallazgos del análisis y decisiones (`OD-nn`): estado, opciones y recomendación |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Guía de [`db/schema.sql`](db/schema.sql): cómo aplicarlo en Supabase, RLS, qué decisiones materializa |

## Reglas no negociables (resumen)

1. Usuario ≠ Organización; un usuario pertenece a varias y cada una aprueba sus memberships.
2. *Private by default*: cada organización controla su información; solo se comparte lo explícito.
3. Las relaciones comprador/proveedor se aceptan antes de operar.
4. Una requisición genera **una** orden; aceptar una cotización crea la orden automáticamente.
5. El proveedor confirma/rechaza órdenes y registra entregas; el comprador confirma recepción.
6. Cancelar nunca elimina; todo queda auditado.
7. API + webhooks forman parte del MVP. Facturación, pagos, scoring, negociación formal, IA y DMS quedan fuera.

Lista completa en [PRODUCT_OVERVIEW.md §5](docs/PRODUCT_OVERVIEW.md#5-principios-de-arquitectura-no-negociables).

## Siguiente paso

Stack decidido: **Next.js en Vercel + Supabase (PostgreSQL, Auth, Storage) + Inngest** (ORM: OD-37). Todas las decisiones que bloqueaban el esquema y la arquitectura están cerradas (ver *Estado de decisiones* en [OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md)); quedan las de flujo/configuración. Secuencia:

```text
Database schema → Backend architecture → API → Authorization → Frontend → Core UI → Testing → Deployment
```
