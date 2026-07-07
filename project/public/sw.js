// Service Worker for Dolsan Feeding System PWA
// Version: 1.0.0

const CACHE_VERSION = 'dolsan-feeding-v1.0.1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// Static assets to cache on install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/dashboard.css',
    '/css/components.css',
    '/js/dashboard.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// API endpoints that should always use network-first strategy
const API_ENDPOINTS = [
    '/api/',
    '/mqtt'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Static assets cached successfully');
                return self.skipWaiting(); // Activate immediately
            })
            .catch((error) => {
                console.error('[SW] Failed to cache static assets:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((cacheName) => {
                            // Delete old caches that don't match current version
                            return cacheName.startsWith('dolsan-feeding-') && 
                                   cacheName !== STATIC_CACHE && 
                                   cacheName !== DYNAMIC_CACHE;
                        })
                        .map((cacheName) => {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Service worker activated');
                return self.clients.claim(); // Take control immediately
            })
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip cross-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    // Network-first strategy for API endpoints (MQTT communication)
    if (API_ENDPOINTS.some(endpoint => url.pathname.startsWith(endpoint))) {
        event.respondWith(networkFirstStrategy(request));
        return;
    }

    // Cache-first strategy for static assets
    event.respondWith(cacheFirstStrategy(request));
});

// Cache-first strategy: Try cache first, fallback to network
async function cacheFirstStrategy(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Serving from cache:', request.url);
            return cachedResponse;
        }

        console.log('[SW] Fetching from network:', request.url);
        const networkResponse = await fetch(request);

        // Cache successful responses
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.error('[SW] Fetch failed:', error);
        
        // Return offline page or fallback
        const cachedResponse = await caches.match('/index.html');
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Offline - Please check your connection', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
                'Content-Type': 'text/plain'
            })
        });
    }
}

// Network-first strategy: Try network first, fallback to cache
async function networkFirstStrategy(request) {
    try {
        console.log('[SW] Network-first for API:', request.url);
        const networkResponse = await fetch(request);
        
        // Cache successful API responses for offline fallback
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('[SW] Network failed, trying cache:', request.url);
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response(JSON.stringify({
            error: 'Offline',
            message: 'MQTT broker unavailable. Please check your local network connection.'
        }), {
            status: 503,
            headers: new Headers({
                'Content-Type': 'application/json'
            })
        });
    }
}

