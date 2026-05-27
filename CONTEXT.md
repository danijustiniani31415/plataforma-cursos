# CONTEXT — Plataforma Cursos SST

Plataforma de capacitación en SST (Seguridad, Salud en el Trabajo) para **CV Global S.A.C.** Sistema multi-empresa, multi-rol. Sin paso de build — los archivos se sirven tal cual desde Cloudflare Workers.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Vanilla JS + HTML5 + CSS3 (multi-page app) |
| Dev server | Vite (solo desarrollo, `npm run dev`) |
| Backend | Supabase (PostgREST + Auth + Storage) |
| Edge Functions | Deno/TypeScript (`supabase/functions/`) |
| Deploy | Cloudflare Workers (`wrangler.toml`) |
| Email | Resend API (desde edge functions) |
| PDF | jsPDF client-side (`certificado.js`) |
| Autocomplete DNI | RENIEC API via apiperu.dev |
| UI helpers | Tom Select (dropdowns), `toast.js` (notificaciones) |

> React está instalado pero **no se usa activamente**. Vite solo sirve como dev server.

---

## Archivos Principales

| Archivo | Tamaño | Propósito |
|---------|--------|----------|
| `main.js` | 46 KB | Login dual + dashboard usuario + flujo de cursos |
| `admin.js` | 190 KB | Panel admin completo (CRUDs, reportes, bulk import) |
| `superadmin.js` | 21 KB | Panel superadmin (empresas, admins, cargos) |
| `certificado.js` | 15 KB | Generación PDF de certificados con jsPDF |
| `toast.js` | 8 KB | Notificaciones toast + traducción errores Supabase al español |
| `sw.js` | 3.4 KB | Service Worker PWA (caché estratificada) |
| `styles.css` | 39 KB | Estilos globales (vars: navy `#002855`, gold `#c9a84c`) |
| `admin.html` | 62 KB | Interface admin (tabs, formularios) |
| `src/supabaseClient.js` | 444 B | Init cliente Supabase (URL + anon key hardcodeadas) |

---

## Páginas (Entry Points HTML)

| Archivo | Descripción |
|---------|------------|
| `index.html` | Login + dashboard usuario (Mis Cursos) |
| `admin.html` | Panel administrador |
| `superadmin.html` | Panel superadmin |
| `cambiar-clave.html` | Cambio de contraseña (forzado en primer login) |
| `recuperar-clave.html` | Recovery de contraseña |
| `verificar.html` | Verificación pública de certificados (sin login) |
| `qr-asistencia.html` | Registro de asistencia presencial por QR |
| `registrosUsuarios.html` | Registros/auditoría de usuarios |
| `offline.html` | Fallback PWA sin conexión |

---

## Roles del Sistema

| Rol | Acceso |
|-----|--------|
| Trabajador | Solo sus cursos asignados (login con DNI) |
| Admin | Gestión de su empresa (usuarios, cursos, reportes) |
| Gestor | Solo importar y actualizar trabajadores |
| Superadmin | Todo: empresas, admins, cargos, todos los usuarios |

**Login trabajador:** email sintético `{DNI}@cvglobal.pe` con contraseña del trabajador.  
**Login admin/superadmin:** email real.  
`debe_cambiar_password = true` en profiles → redirige a `cambiar-clave.html` post-login.

---

## Flujo de Curso (Secuencial Obligatorio)

```
Material → Videos → Asistencia → Encuesta → Examen eficacia → Examen final → Certificado
```

Cada paso desbloquea el siguiente. Solo aparecen los pasos que el curso tiene configurados. El certificado se genera cuando el trabajador aprueba la evaluación final.

---

## Edge Functions (Supabase / Deno)

### `supabase/functions/enviar-certificado/`
- Genera código correlativo `{PREFIJO}-{AÑO}-{NÚMERO}`
- Incrementa `correlativo` en tabla `cursos`
- Inserta en tabla `certificados`
- Envía email vía Resend (actualmente deshabilitado)

### `supabase/functions/enviar-notificaciones/`
- Inputs: `empresa_id`, `tipo` (pendientes / vencimientos / ambos)
- Detecta cursos pendientes del mes y certificados por vencer (<30 días)
- Envía email HTML personalizado vía Resend por trabajador

### `supabase/functions/actualizar-usuario/`
- Actualiza `profiles` + Supabase Auth (email/password)
- Usa `SUPABASE_SERVICE_ROLE_KEY` para escapar RLS
- Llamado desde `admin.js` al editar datos de un trabajador

---

## Tablas Supabase Clave

| Tabla | Campos importantes |
|-------|--------------------|
| `profiles` | id, rol, empresa_id, debe_cambiar_password, email, nombres, apellidos, dni |
| `empresas` | id, nombre, ruc, activo |
| `cargos` | id, nombre, empresa_id |
| `cursos` | id, titulo, vigencia_meses, correlativo, codigo_prefijo, url_material, activo |
| `videos_curso` | id, id_curso, url, titulo, orden, activo |
| `formularios` | id, id_curso, tipo (examen/eficacia/encuesta), preguntas, activo |
| `envios_formulario` | id, usuario_email, id_curso, aprobado, created_at |
| `certificados` | id, usuario_id, curso_id, codigo, nota, nombres, apellidos, dni, cargo, empresa |
| `asignaciones_mes` | id, empresa_id, documento_numero, mes, anio |

---

## Deploy

- **Cloudflare Workers** vía `wrangler.toml` — sirve todo el directorio raíz como SPA estática
- `Cache-Control: no-cache, must-revalidate` en `.js` y `.html`
- `npm run build` es un **no-op** (no hay bundling)
- URL producción: `https://plataforma-cursos.sdjustiniani-a.workers.dev`

---

## Supabase

- URL: `https://wrahjlstautwinxyqcfx.supabase.co`
- Anon key en `src/supabaseClient.js` (pública por diseño, seguridad via RLS)
- Secrets de edge functions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`

---

## PWA (Service Worker `sw.js`)

- **CACHE_NAME:** `cvglobal-sst-v9` — incrementar al cambiar estrategia de caché
- CDN assets → cache-first
- Supabase API → siempre red (no interceptado)
- HTML → siempre red (nunca cacheado)
- Assets locales JS/CSS → network-first con fallback a caché
- Offline fallback → `/offline.html`

---

## Patrones de Código Recurrentes

- **`chunkedInQuery()`** — ejecuta queries `.in()` en chunks para evitar URLs largas (issue previo)
- **`normalizarDNI()`** — padding a 8 dígitos con ceros a la izquierda
- **Tom Select** (CDN) — dropdowns con búsqueda en admin
- **`toast()` / `alertToToast()`** — reemplazan `alert()`, traducen errores de Supabase al español
- Coordenadas del PDF están hardcodeadas en `certificado.js`
- RENIEC API key hardcodeada en `superadmin.js`
