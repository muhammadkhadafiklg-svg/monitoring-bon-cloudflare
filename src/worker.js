// Pintu masuk Worker: /api/* ditangani Worker, selain itu disajikan sebagai file statis dari folder public.
import { tangani } from './handler.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (m) return tangani(request, env, m[1], function (p) { ctx.waitUntil(p); });
    return env.ASSETS.fetch(request);
  }
};
