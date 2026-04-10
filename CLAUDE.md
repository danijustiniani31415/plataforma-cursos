# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Instalar dependencias
npm run dev          # Dev server Vite (http://localhost:5173)
npm run preview      # Preview del build
```

Supabase Edge Functions (en `supabase/functions/`) corren en Deno y se despliegan con Supabase CLI.

Desplegado en **Cloudflare Workers** (ver `wrangler.toml`) como sitio estático — sin backend Node.js.

## Architecture

**Multi-page app** con vanilla JS + Supabase como backend. Cada HTML es su propio entry point:

- `index.html` / `main.js` — Login y dashboard de usuario (lista de cursos, progreso, certificados)
- `admin.html` / `admin.js` — Panel admin (gestión de usuarios, asignaciones, reportes)
- `superadmin.html` / `superadmin.js` — Panel superadmin (gestión de empresas)
- `cambiar-clave.html` — Cambio de contraseña (forzado en primer login por flag `debe_cambiar_password`)
- `qr-asistencia.html` — Registro de asistencia por QR para sesiones presenciales

Hay un setup mínimo de React en `src/App.jsx` vía Vite, pero la lógica principal es vanilla JS.

### Course Flow (main.js)

El flujo de un curso es secuencial y obligatorio: **Material → Videos → Asistencia → Encuesta → Examen de eficacia → Examen final → Certificado**. Cada paso desbloquea el siguiente.

### Data Layer

Todo acceso a datos va por **Supabase** (PostgREST + Auth + Storage). El cliente se inicializa en `src/supabaseClient.js`. Tablas clave: `profiles`, `cursos`, `videos_curso`, `empresas`, `cargos`, `certificados`, `envios_formulario`, `formularios`, `asignaciones_mes`.

### Supabase Edge Functions (Deno/TypeScript)

- `supabase/functions/enviar-certificado/` — Genera códigos de certificado (formato YYYY-NNNN), guarda en tabla `certificados`, envía email vía Resend API
- `supabase/functions/enviar-notificaciones/` — Envía recordatorios de cursos pendientes y certificaciones por vencer

### Certificate PDF Generation

Client-side en `certificado.js` usando jsPDF con fuentes personalizadas, logos y firmas desde Supabase Storage. Las coordenadas de posición están definidas directamente en el archivo.

### Auth & Roles

Auth email/password de Supabase con tres roles: usuario regular, `admin`, `superadmin`. El rol se guarda en `profiles.rol`. RLS activo en todas las tablas.

### Service Worker (sw.js)

PWA con caché `cvglobal-sst-v8`. CDN assets: cache-first. Llamadas a Supabase: siempre a red. HTML: nunca se cachea. Fallback offline: `offline.html`.

### UI Patterns

- `toast.js` — Sistema de notificaciones toast y modales (reemplaza `alert()`, traduce errores de Supabase al español)
- Tom Select (CDN) — Dropdowns con búsqueda
- CSS variables para theming (navy `#002855`, gold `#c9a84c`)

## Environment Variables

La URL de Supabase y anon key están en `src/supabaseClient.js`. Las edge functions requieren `SUPABASE_SERVICE_ROLE_KEY` y `RESEND_API_KEY` como variables de entorno.

## Language

La UI y contenido de cara al usuario están en **español peruano (es-PE)**. Los comentarios y nombres de variables mezclan español e inglés.
