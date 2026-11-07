self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", evento => evento.waitUntil(self.clients.claim()));

self.addEventListener("fetch", evento => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (pedido.mode !== "navigate" || pedido.method !== "GET" || url.origin !== self.location.origin ||
      !["/", "/index.html", "/cardapio.html", "/kds.html", "/monitor.html"].includes(url.pathname)) return;

  evento.respondWith(fetch(pedido).catch(() => new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>R Sistemas</title><main style="font:1rem system-ui;padding:24px"><h1>Sem conexão</h1><p>Conecte-se à internet e atualize a tela para continuar.</p></main>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  )));
});
