# PROCURA

Plataforma B2B de **procurement e interoperabilidad entre organizaciones**: requisiciones, aprobaciones, cotizaciones, órdenes, entregas y recepciones — con una API y webhooks para que sistemas externos (ERP) originen y sigan el flujo.

```text
Requisición → Aprobación → Proveedor → Cotización → Orden → Entrega → Recepción
```

## Estado

✅ **MVP funcional, desplegado** en Vercel + Supabase (`https://procura-theta.vercel.app`).

- **Backend:** ~155 endpoints en `/api/v1` (requisiciones, aprobaciones, RFQ/cotizaciones, órdenes, entregas/recepciones, catálogo e importación, relaciones, colaboración y adjuntos, notificaciones, webhooks, API keys, portal). RLS forzado en todas las tablas.
- **Frontend:** todas las pantallas del flujo completo (comprador y proveedor), administración, integraciones y portal público `/{slug}/solicitar`. Responsive y auditado con axe-core (WCAG AA).
- **Pendiente antes de operar con clientes:** ver [`docs/PUESTA_EN_MARCHA.md`](docs/PUESTA_EN_MARCHA.md).

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

Puesta en marcha con clientes reales: [`docs/PUESTA_EN_MARCHA.md`](docs/PUESTA_EN_MARCHA.md) (variables de entorno, Supabase Auth, cron, datos de prueba, límites conocidos y backlog).
