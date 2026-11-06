/* =========================================================
   QMS Quebra · Service Worker
   App shell offline + atualização controlada
   ========================================================= */
const VERSAO = 'qms-quebra-v1.1.0';
const CACHE_APP = `${VERSAO}-app`;

const ARQUIVOS = [
  './',
  'index.html',
  'manifest.json',
  'css/estilos.css',
  'js/utils.js',
  'js/db.js',
  'js/modelo.js',
  'js/vendor/exceljs.min.js',
  'js/export.js',
  'js/share.js',
  'js/app.js',
  'img/logo.png',
  'img/favicon.png',
  'img/icone-192.png',
  'img/icone-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_APP)
      .then((cache) => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves
          .filter((chave) => chave !== CACHE_APP)
          .map((chave) => caches.delete(chave))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  /* Navegação: rede primeiro, cache como reserva */
  if (requisicao.mode === 'navigate') {
    evento.respondWith(
      fetch(requisicao)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_APP).then((cache) => cache.put('index.html', copia));
          return resposta;
        })
        .catch(() => caches.match('index.html').then((resposta) => resposta || caches.match('./')))
    );
    return;
  }

  /* Estáticos: cache primeiro, atualizando em segundo plano */
  evento.respondWith(
    caches.match(requisicao).then((emCache) => {
      const rede = fetch(requisicao)
        .then((resposta) => {
          if (resposta && resposta.status === 200 && resposta.type === 'basic') {
            const copia = resposta.clone();
            caches.open(CACHE_APP).then((cache) => cache.put(requisicao, copia));
          }
          return resposta;
        })
        .catch(() => emCache);

      return emCache || rede;
    })
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data === 'SKIP_WAITING') self.skipWaiting();
});
