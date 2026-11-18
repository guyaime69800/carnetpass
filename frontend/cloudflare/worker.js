import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import middleware from '../middleware.js';
import { resolveRoute, dispatchNode } from './router.js';
import { workerConfiguration, apiConfiguration } from './environment.js';

const server = createServer((req, res) => {
  let route;
  try { route = resolveRoute(new URL(req.url, 'https://www.carnetpass.fr')); }
  catch { res.writeHead(400); res.end(); return; }
  dispatchNode(req, res, route);
});
const nodeHandler = httpServerHandler(server);
const schedules = { '*/5 * * * *': '/api/stripe-webhook?reconcile=1', '0 8 * * *': '/api/maintenance-reminders', '15 * * * *': '/api/maintenance-reminders?data_cleanup=1' };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { return new Response(null, { status: 400 }); }
    // The static-assets binding is private to the Worker, never a public index endpoint.
    if (decoded.startsWith('/__carnetpass_private') || /%|\\/.test(decoded)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
    if (workerConfiguration(env)) return new Response('Configuration Cloudflare indisponible.', { status: 503, headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } });
    if (env.CARNETPASS_ENV === 'production' && !['carnetpass.fr', 'www.carnetpass.fr'].includes(url.hostname)) return new Response(null, { status: 421, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
    if (env.CARNETPASS_ENV === 'production' && url.hostname === 'carnetpass.fr') { url.hostname = 'www.carnetpass.fr'; return Response.redirect(url, 308); }
    const headers = new Headers(request.headers);
    headers.delete('x-vercel-protection-bypass');
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || 'unknown');
    headers.set('x-real-ip', request.headers.get('cf-connecting-ip') || 'unknown');
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1)); headers.set('host', url.host);
    request = new Request(request, { headers });
    const gate = await middleware(request);
    if (gate.headers.get('x-middleware-next') !== '1') return gate;
    const gateHeaders = new Headers(gate.headers);
    gateHeaders.delete('x-middleware-next');
    let response;
    if (url.pathname.startsWith('/api/')) {
      if (apiConfiguration(env)) return new Response('Configuration serveur requise.', { status: 503, headers: gateHeaders });
      let route;
      try { route = resolveRoute(url); } catch { return new Response('Paramètres de route invalides.', { status: 400, headers: gateHeaders }); }
      if (!route) response = new Response('Route inconnue.', { status: 404 });
      else if (route.web) response = await (await route.load()).default(request);
      else response = await nodeHandler.fetch(request, env, ctx);
    } else {
      response = await env.ASSETS.fetch(request);
      if (response.status === 404 && !/\.[^/]+$/.test(url.pathname)) response = await env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: request.method, headers }));
    }
    const result = new Response(response.body, response);
    for (const [name, value] of gate.headers) if (name !== 'x-middleware-next') result.headers.set(name, value);
    result.headers.delete('x-middleware-next'); return result;
  },
  async scheduled(controller, env, ctx) {
    if (env.CARNETPASS_ENV !== 'production' || env.CARNETPASS_SCHEDULED_ENABLED !== 'true' || env.CARNETPASS_SCHEDULER_OWNER !== 'cloudflare') return;
    const route = schedules[controller.cron];
    if (!route || !env.CRON_SECRET || apiConfiguration(env)) throw Error('Scheduled configuration unavailable');
    const response = await this.fetch(new Request('https://www.carnetpass.fr' + route, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }), env, ctx);
    if (!response.ok) throw Error('Scheduled invocation failed');
  },
};
