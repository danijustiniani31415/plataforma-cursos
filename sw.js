const CACHE_NAME = 'cvglobal-sst-v4';

// Solo assets estáticos — NUNCA cachear páginas HTML de admin
const STATIC_ASSETS = [
  '/styles.css',
  '/Logo.png',
  '/manifest.json',
  '/offline.html',
];

// CDNs externos que se cachean al primer uso
const CDN_HOSTS = [
  'cdn.sheetjs.com',
  'cdn.jsdelivr.net',
  'esm.sh',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── Instalación: cachear assets estáticos ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Si algún asset falla, continuar sin él
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activación: limpiar caches antiguas ────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia por tipo de request ──────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → siempre red (no cachear datos sensibles)
  if (url.hostname.includes('supabase.co')) {
    return; // dejar pasar sin interceptar
  }

  // CDN externos → Cache first, luego red
  if (CDN_HOSTS.some(host => url.hostname.includes(host))) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // HTML → siempre red, nunca cachear
  if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
    return;
  }

  // Assets locales (CSS, JS, imágenes) → Cache first, luego red
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
});

// Estrategia: Cache first → si no hay, busca en red y guarda en cache
async function cacheFirst(request) {
  // Solo cachear GET
  if (request.method !== 'GET') return fetch(request);

  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const offline = await caches.match('/offline.html');
    return offline || new Response('Sin conexión', { status: 503 });
  }
}
