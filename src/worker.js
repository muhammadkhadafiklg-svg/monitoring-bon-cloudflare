import { tangani } from './handler.js';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cache-Control'
        }
      });
    }

    const url = new URL(request.url);
    const segmen = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const nama = segmen[0] === 'api' ? segmen[1] : segmen[0];

    return tangani(request, env, nama, ctx.waitUntil.bind(ctx));
  }
};
