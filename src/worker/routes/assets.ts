import { Hono } from 'hono';
import type { AppContextEnv } from '@/worker/types';

export const assetsRoutes = new Hono<AppContextEnv>();

assetsRoutes.get('/*', async (c) => {
  const fullPath = c.req.path;
  const prefix = '/api/assets/';
  const key = fullPath.startsWith(prefix) ? decodeURIComponent(fullPath.slice(prefix.length)) : '';

  if (!key || key.includes('..') || !key.startsWith('branding/')) {
    return c.json({ error: 'الملف غير موجود' }, 404);
  }

  const object = await c.env.BUCKET.get(key);
  if (!object) {
    return c.json({ error: 'الملف المطلوب غير متوفر في التخزين' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  headers.set(
    'content-security-policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
  );

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/octet-stream');
  }

  return new Response(object.body, {
    status: 200,
    headers,
  });
});
