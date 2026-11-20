import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createDb, ensureSystemBootstrapped } from '@/db';
import { ServerConfigError } from '@/worker/utils/jwt';
import type { AppContextEnv } from '@/worker/types';
import { authRoutes } from '@/worker/routes/auth';
import { settingsRoutes } from '@/worker/routes/settings';
import { assetsRoutes } from '@/worker/routes/assets';
import { usersRoutes } from '@/worker/routes/users';
import { productsRoutes } from '@/worker/routes/products';
import { customersRoutes } from '@/worker/routes/customers';
import { subMerchantsRoutes } from '@/worker/routes/subMerchants';
import { dashboardRoutes } from '@/worker/routes/dashboard';
import { dailySheetsRoutes } from '@/worker/routes/dailySheets';
import { dailyOrdersRoutes } from '@/worker/routes/dailyOrders';
import { reportsRoutes } from '@/worker/routes/reports';
import { auditLogRoutes } from '@/worker/routes/auditLogs';

const app = new Hono<AppContextEnv>();

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'",
].join('; ');

function withSecurityHeaders(response: Response, requestUrl: string, cacheControl?: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  if (new URL(requestUrl).protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Global error handler returning structured Arabic JSON responses
app.use('*', async (c, next) => {
  await next();
  const cacheControl = c.req.path.startsWith('/api/') && !c.req.path.startsWith('/api/assets/')
    ? (c.res.headers.has('etag') ? 'private, no-cache' : 'private, no-store')
    : undefined;
  c.res = withSecurityHeaders(c.res, c.req.url, cacheControl);
});

app.onError((err, c) => {
  console.error('[Worker Error]', err);
  if (err instanceof ServerConfigError) {
    return c.json({ error: err.message, code: err.code }, 500);
  }
  return c.json(
    {
      error: 'حدث خطأ غير متوقع في الخادم، يرجى المحاولة مرة أخرى',
      code: 'INTERNAL_SERVER_ERROR',
    },
    500
  );
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/settings/upload') return next();
  return bodyLimit({
    maxSize: 256 * 1024,
    onError: (context) => context.json({ error: 'حجم البيانات المرسلة يتجاوز الحد المسموح', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })(c, next);
});

// Initialize Drizzle D1 instance and guarantee bootstrap records on API routes
app.use('/api/*', async (c, next) => {
  const db = createDb(c.env.DB);
  c.set('db', db);
  await ensureSystemBootstrapped(db, c.env);
  await next();
});

// Mount Phase 1 API routers
app.route('/api/auth', authRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/assets', assetsRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/products', productsRoutes);
app.route('/api/customers', customersRoutes);
app.route('/api/sub-merchants', subMerchantsRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/daily-sheets', dailySheetsRoutes);
app.route('/api/daily-orders', dailyOrdersRoutes);
app.route('/api/reports', reportsRoutes);
app.route('/api/audit-logs', auditLogRoutes);

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'المسار المطلوب غير موجود', code: 'NOT_FOUND' }, 404);
  }
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default app;
