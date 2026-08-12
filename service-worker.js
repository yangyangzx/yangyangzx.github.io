/**
 * TradingDiscipline Service Worker
 * 提供离线缓存和 PWA 安装支持
 */
var CACHE_NAME = 'tradingdisc-v5-cache';
// 缓存版本 - 每次更新代码时递增，强制浏览器重新缓存所有资源
var CACHE_VERSION = 2;
var VERSIONED_CACHE_NAME = CACHE_NAME + '-v' + CACHE_VERSION;
var STATIC_ASSETS = [
  './',
  './index.html',
  './css/variables.css',
  './css/base.css',
  './css/calculator.css',
  './css/table.css',
  './css/modals.css',
  './css/responsive.css',
  './css/layout.css',
  './css/dashboard.css',
  './css/planner.css',
  './css/risk.css',
  './css/analytics.css',
  './css/review.css',
  './css/settings.css',
  './js/constants.js',
  './js/utils.js',
  './js/toast.js',
  './js/storage.js',
  './js/calculator.js',
  './js/logs.js',
  './js/rendering.js',
  './js/stats.js',
  './js/modals.js',
  './js/navigation.js',
  './js/dashboard.js',
  './js/planner.js',
  './js/settings.js',
  './js/skills-integration.js',
  './js/risk.js',
  './js/analytics.js',
  './js/review.js',
  './js/io.js',
  './js/app.js',
  './img/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(VERSIONED_CACHE_NAME).then(function(cache) {
      console.log('[SW] 缓存核心资源 (v' + CACHE_VERSION + ')');
      return cache.addAll(STATIC_ASSETS);
    }).catch(function(err) {
      console.warn('[SW] 部分资源缓存失败（可能来自 CDN）:', err);
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) {
          // 删除非当前版本的缓存
          return name !== VERSIONED_CACHE_NAME && name.startsWith(CACHE_NAME);
        }).map(function(name) {
          console.log('[SW] 删除旧缓存:', name);
          return caches.delete(name);
        })
      );
    }).then(function() {
      // 获取页面控制权
      return self.clients.claim();
    })
  );
});

// 请求：先查缓存，再网络
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Chart.js / Font Awesome CDN — 仅 GET 请求
  if (url.protocol === 'https:' && (
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.googleapis.com')
  )) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(VERSIONED_CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() {
          return new Response('CDN unavailable', { status: 503 });
        });
      })
    );
    return;
  }

  // 静态资源 — Cache First（跳过非 http/https 协议，如 chrome-extension://）
  if (event.request.method === 'GET') {
    var reqUrl = new URL(event.request.url);
    if (reqUrl.protocol !== 'http:' && reqUrl.protocol !== 'https:') {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(VERSIONED_CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() {
          // 网络失败时返回缓存或 index.html（SPA fallback）
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 非 GET 请求（如 localStorage 写入等）— 直接通过网络
  event.respondWith(fetch(event.request));
});

// 消息：清缓存命令
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(VERSIONED_CACHE_NAME).then(function() {
      console.log('[SW] 缓存已清除');
    });
  }
  // 跳过等待，立即激活新版本
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
