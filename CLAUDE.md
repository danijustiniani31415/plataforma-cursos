# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Instalar dependencias
npm run dev          # Dev server Vite (http://localhost:5173)
npm run preview      # Preview
```

`npm run build` es un no-op (`echo 'static site, no build needed'`) — no hay paso de bundling para producción; los archivos HTML/JS se sirven tal cual.

Supabase Edge Functions (en `supabase/functions/`) corren en Deno y se despliegan con Supabase CLI (`supabase functions deploy <nombre>`).

Desplegado en **Cloudflare Workers** (ver `wrangler.toml`) como sitio estático — sin backend Node.js. El worker sirve todo el directorio raíz, con `single-page-application` 404 handling, y añade `Cache-Control: no-cache, must-revalidate` a todo `.js` y `.html`.

## Architecture

**Multi-page app** con vanilla JS + Supabase como backend. Cada HTML es su propio entry point:

- `index.html` / `main.js` — Login y dashboard de usuario (lista de cursos, progreso, certificados)
- `admin.html` / `admin.js` — Panel admin (gestión de usuarios, asignaciones, reportes)
- `superadmin.html` / `superadmin.js` — Panel superadmin (gestión de empresas)
- `cambiar-clave.html` — Cambio de contraseña (forzado en primer login por flag `debe_cambiar_password`)
- `recuperar-clave.html` — Flujo de recuperación de contraseña
- `verificar.html` — Verificación pública de certificados por código/DNI (sin login)
- `qr-asistencia.html` — Registro de asistencia por QR para sesiones presenciales
- `registrosUsuarios.html` — Registros de usuarios

Hay un setup mínimo de React en `src/App.jsx` vía Vite, pero la lógica principal es vanilla JS.

### Course Flow (main.js)

El flujo de un curso es secuencial y obligatorio: **Material → Videos → Asistencia → Encuesta → Examen de eficacia → Examen final → Certificado**. Cada paso desbloquea el siguiente.

### Data Layer

Todo acceso a datos va por **Supabase** (PostgREST + Auth + Storage). El cliente se inicializa en `src/supabaseClient.js` — la URL y la anon key están hardcodeadas en ese archivo (no hay `.env` en el frontend; la anon key es pública por diseño, la seguridad depende de RLS).

Tablas clave: `profiles`, `cursos`, `videos_curso`, `empresas`, `cargos`, `certificados`, `envios_formulario`, `formularios`, `asignaciones_mes`.

### Supabase Edge Functions (Deno/TypeScript)

- `enviar-certificado/` — Genera códigos de certificado (formato YYYY-NNNN), guarda en tabla `certificados`, envía email vía Resend API
- `enviar-notificaciones/` — Envía recordatorios de cursos pendientes y certificaciones por vencer
- `actualizar-usuario/` — Actualiza `profiles` y email/password en Supabase Auth usando service role (escapa a los límites de RLS para operaciones de admin)

### Certificate PDF Generation

Client-side en `certificado.js` usando jsPDF con fuentes personalizadas, logos y firmas desde Supabase Storage. Las coordenadas de posición están definidas directamente en el archivo.

### Auth & Roles

Auth email/password de Supabase con tres roles: usuario regular, `admin`, `superadmin`. El rol se guarda en `profiles.rol`. RLS activo en todas las tablas. Operaciones privilegiadas (crear/modificar usuarios de otras empresas, etc.) pasan por la edge function `actualizar-usuario` con service role.

### Service Worker (sw.js)

PWA. CDN assets: cache-first. Llamadas a Supabase: siempre a red (no interceptadas). HTML: nunca se cachea (se deja pasar a red). Assets locales: network-first con cache fallback. Fallback offline: `offline.html`. Al cambiar estrategia de caché, incrementar `CACHE_NAME` al tope de `sw.js` para forzar invalidación.

### UI Patterns

- `toast.js` — Sistema de notificaciones toast y modales (reemplaza `alert()`, traduce errores de Supabase al español)
- Tom Select (CDN) — Dropdowns con búsqueda
- CSS variables para theming (navy `#002855`, gold `#c9a84c`)

## Environment Variables

Frontend: la URL de Supabase y anon key están en `src/supabaseClient.js` (hardcodeadas). Las edge functions requieren `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `RESEND_API_KEY` como secrets configurados en Supabase.

## Language

La UI y contenido de cara al usuario están en **español peruano (es-PE)**. Los comentarios, mensajes de commit y nombres de variables mezclan español e inglés.
