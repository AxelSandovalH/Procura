# PROCURA — MVP Scope

> Qué entra, qué queda explícitamente fuera y qué se modela sin implementar.
> Referencias `OD-nn` → [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

Leyenda: ✅ **IN** (MVP) · 🟡 **MODELADO** (esquema/enum preparado, sin UI ni endpoints) · ⏭ **v1.1** (siguiente iteración) · ❌ **OUT** (no en el horizonte del MVP).

---

## 1. Flujo principal (el corazón — todo IN)

| Capacidad | Estado | Notas |
|---|---|---|
| Requisición manual, por API, por portal | ✅ | Misma entidad, tres orígenes |
| Conceptos de catálogo propio, de catálogo compartido, libres | ✅ | Libres configurable por organización |
| Conceptos multi-ubicación | ✅ | `location_id` por concepto |
| Aprobación multinivel secuencial con reglas (monto, departamento, tipo, categoría) | ✅ | |
| Rechazo, solicitud de cambios, retiro | ✅ | |
| Re-aprobación por cambio material | ✅ | Política configurable (OD-07) |
| Aprobación por concepto | 🟡 / OD-08 | Enum y `concept_id` en decisión listos; UI recomendada v1.1 |
| RFQ a N proveedores con relación ACTIVE | ✅ | Una RFQ por proveedor |
| Cotización con líneas, sustituciones, alternativas, adicionales, declinadas | ✅ | |
| Versiones de cotización (revisar) | ✅ / OD-04 | |
| Vigencia y expiración automática | ✅ | Job diario |
| Comparación side-by-side | ✅ | Solo lectura, sin scoring |
| Aceptar cotización → orden automática | ✅ | Regla 7 |
| Confirmar / rechazar / IN_PROCESS / cancelar orden (ambos lados) | ✅ | Reglas 8–11 |
| Cierre corto de orden | ✅ / OD-15 | |
| Entregas parciales, múltiples entregas por orden | ✅ | |
| Recepción con cantidades recibidas/aceptadas/rechazadas + tipo de discrepancia | ✅ | |
| Evidencia de entrega/servicio como adjuntos | ✅ | Fotos, PDFs |

## 2. Organizaciones, identidad, RBAC

| Capacidad | Estado | Notas |
|---|---|---|
| Registro, login, verificación de email, reset | ✅ | |
| MFA / SSO | ⏭ / OD-26 | Diseño no lo impide |
| Usuario multi-organización, cambio de contexto | ✅ | |
| Membership con aprobación / invitación por link o email | ✅ | |
| Primary admin + administración delegada + no-escalación | ✅ | |
| Roles base instanciados + roles personalizados | ✅ | |
| Scopes ORGANIZATION / DEPARTMENT / LOCATION | ✅ | |
| Scopes RELATIONSHIP / CATEGORY / COST_CENTER / OPERATION_TYPE | 🟡 | Enum reservado; sin evaluación |
| Departamentos y localizaciones | ✅ | Un nivel; `parent_id` reservado |
| Jerarquía Grupo → Empresa | ❌ | Brief §3 |
| Verificación de identidad de organizaciones (RFC, documentos) | ⏭ / OD-20 | Riesgo R-01 |

## 3. Relaciones y catálogo

| Capacidad | Estado | Notas |
|---|---|---|
| Buscar organización, solicitar, aceptar/rechazar | ✅ | |
| Invitación de relación por link/código, auto-aceptación configurable | ✅ | |
| Suspender / reactivar / finalizar | ✅ | Efectos en curso: OD-13 |
| Términos comerciales básicos (moneda, pago, ubicaciones, instrucciones de cotización) | ✅ | Texto/valores simples |
| Contactos por relación | ✅ | |
| Workflows específicos por relación | ❌ | Brief §6 |
| Catálogo propio + categorías + unidades | ✅ | |
| Importación CSV/XLSX con detección, mapeo, validación, preview, confirmación | ✅ | Upsert por SKU |
| Compartir catálogo (ítems/categorías) con relaciones; comprador selecciona | ✅ | |
| Precio en catálogo compartido | ✅ opcional / OD-19 | Flag `show_price` |
| Listas de precios por relación | ⏭ | |
| Mapeo de SKUs entre organizaciones | ⏭ | Concepto guarda ambos IDs |

## 4. Colaboración, archivos, notificaciones, búsqueda

| Capacidad | Estado | Notas |
|---|---|---|
| Conversación compartida por RFQ / cotización / orden / entrega | ✅ | Por línea (concepto/rfq_line): ✅ |
| Notas internas por requisición / concepto / cotización / orden / entrega | ✅ | Permisos independientes |
| Negociación formal (contraofertas estructuradas) | ❌ | Brief §13 |
| Adjuntos básicos con visibilidad INTERNAL/SHARED y URL firmada | ✅ | Límite de tamaño: OD-27 |
| Antivirus en adjuntos | ⏭ | Riesgo R-06 |
| Gestión documental (versiones, carpetas, OCR) | ❌ | Brief §26 |
| Notificaciones in-app | ✅ | |
| Email para eventos importantes | ✅ | Plantillas por evento |
| Preferencias de notificación / digest | ⏭ | |
| Búsqueda global + filtros avanzados por módulo | ✅ | Índice de BD (tsvector) suficiente en MVP |
| Búsqueda con IA | ❌ | |

## 5. Integraciones y plataforma

| Capacidad | Estado | Notas |
|---|---|---|
| API v1 completa (UI y ERP usan la misma) | ✅ | |
| API keys por organización con roles | ✅ | |
| Webhooks firmados con reintentos + feed `GET /events` | ✅ | |
| Alcance ERP: crear/consultar/cancelar requisiciones, consultar órdenes/entregas/recepciones, recibir eventos | ✅ / OD-22 | |
| ERP actuando como proveedor vía API | ⏭ | Mismos endpoints |
| Auditoría append-only con diff y perspectiva | ✅ | |
| Plantillas de requisición | ✅ | |
| Duplicar / Reordenar | ✅ / OD-28 | |
| Recurrencia automática | ❌ | Brief §28 |
| Portal `procura.app/{slug}/solicitar` con login obligatorio | ✅ | |
| Requisición dirigida (auto-RFQ al aprobar) | ✅ / OD-02 | |

## 6. Fuera del MVP (explícito)

| Capacidad | Estado | Notas |
|---|---|---|
| Devoluciones, incidencias, reposiciones | 🟡 / OD-23 | Enums de discrepancia y campo `replacement_of_return_id` reservados; sin flujo |
| Facturación | ❌ | Brief §20 |
| Pagos | ❌ | Se puede guardar `payment_terms` como texto |
| Scoring / recomendación automática de cotizaciones | ❌ | |
| Conversión multi-moneda | ❌ | Se almacena moneda en cada monto; sin tipo de cambio |
| Motor fiscal / cálculo de impuestos | ❌ / OD-17 | Se guarda `tax_minor` tal como lo captura el proveedor |
| Checklists / firmas configurables para servicios | ⏭ | MVP: adjuntos + notas |
| Tolerancias de sobre-entrega | ⏭ | |
| Reportes / analítica / dashboards | ⏭ | Listados con filtros cubren MVP |
| App móvil nativa | ❌ | UI web responsive |
| i18n multi-idioma | ⏭ / OD-25 | Scaffolding i18n desde el inicio; contenido es-MX |

---

## 7. Requisitos no funcionales del MVP

| Área | Objetivo |
|---|---|
| Aislamiento | Suite de tests de tenancy obligatoria por endpoint (DOMAIN_MODEL §15) |
| Autorización | 100 % de endpoints con permiso declarado; CI falla si no |
| Rendimiento | Listados < 300 ms p95 con 100k requisiciones por org; comparación de 10 cotizaciones < 500 ms |
| Disponibilidad | Single-region, backups diarios + PITR; RPO 15 min, RTO 4 h |
| Webhooks | Entrega ≤ 60 s p95 tras el evento |
| Observabilidad | `request_id` en logs, audit y eventos; métricas por endpoint; alertas de fallos de webhook |
| Seguridad | Checklist RBAC.md §6; dependencias escaneadas; secretos en gestor, no en repo |

---

## 8. Secuencia de implementación propuesta (después de cerrar OPEN DECISIONS)

```text
1. Database schema          ✅ db/schema.sql (2026-09-24, validado) — ver DATABASE_SCHEMA.md
2. Backend architecture      (Route Handlers + policy engine + ORM (OD-37) + Inngest) ← siguiente
3. API implementation        Identity → Orgs/RBAC → Relationships/Catalog → Requisitions/Approvals
                             → Sourcing → Orders → Fulfillment → Collaboration → Integrations
4. Authorization             tests de tenancy + perspectiva por endpoint (se escriben con cada módulo, no al final)
5. Frontend architecture     shell multi-org, contexto activo, available_actions-driven UI
6. Core UI                   flujo principal end-to-end primero; administración después
7. Testing                   E2E del flujo Papillon → Avocabo; carga; seguridad
8. Deployment                staging + prod, migraciones, jobs (expiración, auto-cierre, webhooks)
```

Hito de demo interno: **Papillon crea REQ vía API → aprueba → RFQ a Avocabo → cotiza → orden → 2 entregas parciales → recepción con discrepancia → requisición RESOLVED**, con webhooks recibidos en un ERP simulado.
