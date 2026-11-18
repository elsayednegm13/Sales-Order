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

const app = new Hono<AppContextEnv>();

// Global error handler returning structured Arabic JSON responses
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "frame-ancestors 'none'");
  if (c.req.path.startsWith('/api/') && !c.req.path.startsWith('/api/assets/')) {
    c.header('Cache-Control', 'private, no-store');
  }
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
