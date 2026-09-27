# Puesta en marcha

Estado revisado el 2026-09-26 (commit `abbf70b`). Producción: `https://procura-theta.vercel.app` · Supabase `bmbfheansyswcjnwgbqr` (us-west-2).

## 1. Verificado en esta revisión

| Área | Resultado |
|---|---|
| Build de producción, `tsc`, `eslint` | Sin errores ni warnings |
| `npm audit` | 0 vulnerabilidades |
| Migraciones (`supabase db push --dry-run`) | Remoto al día |
| RLS | Las 100 % de las tablas de `public` con RLS **forzado**; el rol de la app (`procura_app`) no es superuser ni `BYPASSRLS` |
| Aislamiento entre organizaciones | Desde otra organización, órdenes, requisiciones, cotizaciones, catálogo, entregas, hilos y adjuntos ajenos responden `404` y no aparecen en listados |
| Anónimo | `/api/v1/*` → `401`; portal inexistente o apagado → `404` indistinguible; `/api/cron/*` sin secreto → `401`; páginas privadas redirigen a `/login?next=` |
| Producción | Home, login, portal y `/api/v1/health` responden 200 con el último despliegue |
| Accesibilidad / responsividad | axe-core sin violaciones a 375, 768 y 1280 px en 19 pantallas |

## 2. Antes del primer cliente (bloqueantes)

1. **Variables de entorno en Vercel** (Production): `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_URL=https://procura-theta.vercel.app` (o tu dominio), y las dos que **faltan por confirmar**:
   - `SUPABASE_SERVICE_ROLE_KEY` — sin ella fallan los **adjuntos** (Storage).
   - `CRON_SECRET` — sin ella el cron de webhooks no despacha (responde 401).
2. **Plan de Vercel:** `vercel.json` programa el cron cada minuto; el plan Hobby solo permite diario. Con Hobby, los webhooks y sus reintentos se despachan una vez al día.
3. **Correo de Supabase Auth (configurado):** el SMTP por defecto de Supabase tiene un límite muy bajo (pocos correos por hora). Configura un SMTP propio (p. ej. Resend) en *Authentication → SMTP* antes de invitar gente. En *URL Configuration* pon el dominio de producción como Site URL y agrega `https://<dominio>/**` a las Redirect URLs.
4. **Dominio propio** (opcional pero recomendable): al cambiarlo, actualiza `APP_URL` (los enlaces de invitación se generan con él).
5. **Límite de solicitudes (rate limiting):** no existe en el GET público del portal, en el registro ni en el login propio. Supabase Auth aplica sus propios límites al login, pero conviene poner un límite (Vercel WAF o Upstash) antes de abrir el portal a internet.

## 3. Datos de prueba

Limpieza hecha el 2026-09-27 (opción A), con respaldo previo de las 54 tablas públicas (1 582 filas) fuera del repositorio. Se eliminó: la organización TestCo con todo lo suyo, artículos/categorías de prueba de Avocabo, webhooks, llaves de API, invitaciones e importaciones de prueba, y departamentos, ubicaciones, flujos y roles de prueba con sufijo numérico de Papillon.

Quedan **Papillon** (comprador: yates) y **Avocabo** (proveedor: frutas y verduras) con su historial como demostración: 33 requisiciones, 7 órdenes, relación activa en ambos sentidos y el catálogo base `AVO-*`. Para arrancar sin demo, vaciar esas dos organizaciones y dejar solo el usuario (opción B).

## 4. Primer cliente: guía rápida

1. El cliente entra a `/registro`, confirma el correo y crea su organización (`/onboarding`): queda como administrador principal con todos los roles base.
2. Administración → **Roles / Departamentos / Ubicaciones / Flujos de aprobación**: definir quién aprueba qué monto (sin flujo aplicable, todo se aprueba automáticamente).
3. Administración → **Miembros → Invitar** para su equipo (se comparte el enlace; no se envía correo desde Procura).
4. **Relaciones:** buscar al proveedor (debe tener «permitir que me encuentren» activo), o crear una invitación de relación, o usar el portal del proveedor `/{slug}/solicitar`.
5. Proveedor: activar su portal y texto en Administración → Organización; cargar catálogo (Catálogo → Importar) y compartirlo por relación.
6. ERP: Administración → Integraciones → llave de API (rol de compras) y/o webhook.

## 5. Límites conocidos y backlog

- **Correos de aviso (implementados):** cada notificación de la campana se envía también por correo con Resend desde el cron (cada minuto). Requiere `RESEND_API_KEY` y `EMAIL_FROM` en Vercel; sin ellas queda apagado. Cada persona puede desactivarlos en *Mi cuenta*. Los mensajes de conversación se agrupan (uno por conversación cada 10 min); las fallas se reintentan 3 veces.
- **Secreto de webhooks** guardado sin cifrar en BD (documentado; conviene cifrarlo con pgsodium/Vault).
- **No implementado:** dividir requisición (`split`), reorden desde orden, devoluciones/incidencias, edición de entregas y de niveles de flujo en la UI, editar/eliminar endpoints de webhook en la UI, contactos de relación en la UI, invitaciones de relación creadas desde la UI.
- **Decisiones abiertas** `OD-04…OD-33` operan con la opción recomendada (★) de `OPEN_DECISIONS.md`.
- **Importación de catálogo:** probada con CSV; XLSX soportado por la API pero sin prueba end-to-end.
- **Monitoreo:** no hay error tracking ni alertas. Recomendado: Sentry + revisar `domain_events`/`webhook_deliveries` con estado `FAILED`/`EXHAUSTED`.
- **Respaldos:** confirmar en Supabase el plan de backups (PITR solo en planes de pago).
