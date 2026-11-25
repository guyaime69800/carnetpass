import { aliases, apiModules } from './routes.js';
const reserved = key => key.endsWith('_route') || key === 'webhook';
export function resolveRoute(url) {
  const alias = aliases.find(item => item.source === url.pathname);
  if (!alias && !apiModules[url.pathname]) return null;
  const destination = new URL(alias?.destination || url.pathname, url.origin);
  if (alias && [...url.searchParams.keys()].some(reserved)) throw Object.assign(Error('Invalid dispatcher flags'), { status: 400 });
  for (const [key, value] of url.searchParams) destination.searchParams.append(key, value);
  const query = Object.create(null);
  for (const key of new Set(destination.searchParams.keys())) {
    const values = destination.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return { path: destination.pathname, query, load: apiModules[destination.pathname] };
}
export async function dispatchNode(req, res, route) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); return res; };
  res.send = data => { res.end(data); return res; };
  try {
    if (!route?.load) return res.status(404).json({ ok: false });
    req.query = route.query;
    const module = await route.load();
    if (/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') && module.config?.api?.bodyParser !== false && !['GET', 'HEAD'].includes(req.method)) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4.5 * 1024 * 1024) throw Object.assign(Error('Body too large'), { status: 413 });
        chunks.push(chunk);
      }
      try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw Object.assign(Error('Invalid JSON'), { status: 400 }); }
    }
    await module.default(req, res);
  } catch (error) {
    if (!res.headersSent) res.status([400, 413].includes(error.status) ? error.status : 503).json({ ok: false, error: 'Traitement indisponible.' });
    else res.destroy();
  }
}
