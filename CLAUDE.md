# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
```

Supabase Edge Functions (in `supabase/functions/`) run on Deno and are deployed via Supabase CLI.

Deployed to **Cloudflare Workers** (see `wrangler.toml`) as a static site — no Node.js backend.

## Architecture

**Multi-page app** with vanilla JS + Supabase as the backend. Each HTML page is its own entry point with a corresponding JS module:

- `index.html` / `main.js` — Login and user dashboard (course list, progress, certificates)
- `admin.html` / `admin.js` — Admin panel (user management, course assignments, analytics)
- `superadmin.html` / `superadmin.js` — Superadmin panel (company management)
- `cambiar-clave.html` — Password change (forced on first login via `debe_cambiar_password` flag)
- `qr-asistencia.html` — QR-based attendance tracking for in-person sessions

There is a minimal React setup in `src/App.jsx` via Vite, but the main app logic is vanilla JS.

### Data Layer

All data access goes through **Supabase** (PostgREST + Auth + Storage). The client is initialized in `src/supabaseClient.js`. Key tables: `profiles`, `cursos`, `empresas`, `cargos`, `certificados`, `envios_formulario`, `asignaciones_mes`.

### Supabase Edge Functions (Deno/TypeScript)

- `supabase/functions/enviar-certificado/` — Generates certificate codes (YYYY-NNNN format), saves to `certificados` table, sends email via Resend API
- `supabase/functions/enviar-notificaciones/` — Sends reminder emails for pending courses and expiring certificates

### Certificate PDF Generation

Client-side via `certificado.js` using html2pdf.js (HTML → Canvas → PDF). The edge function handles metadata storage and email delivery.

### Auth & Roles

Supabase email/password auth with three roles: regular user, `admin`, `superadmin`. Role is stored in `profiles.rol`. Users with `debe_cambiar_password = true` are redirected to password change.

### Service Worker (sw.js)

PWA with cache name `cvglobal-sst-v8`. CDN assets are cache-first, Supabase API calls always go to network, HTML is never cached. Offline fallback: `offline.html`.

### UI Patterns

- `toast.js` — Toast notification and modal system (replaces native alerts)
- Tom Select (CDN) — Searchable dropdowns
- CSS variables for theming (navy `#002855`, gold `#c9a84c`)
- Loading states via `withLoading()` wrapper, form validation via `fieldValidation()`

## Environment Variables

The Supabase URL and anon key are in `src/supabaseClient.js`. Edge functions require `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` as env variables.

## Language

The app UI and user-facing content are in **Spanish**. Code comments and variable names mix Spanish and English.
