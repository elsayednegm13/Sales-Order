import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { systemSettings, users, type SystemSettingRow } from '@/db/schema';
import type { SystemSettingsDTO } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { requireAdmin, requireAuth } from '@/worker/middleware/auth';
import { readJson, updateSettingsSchema } from '@/worker/schemas';
import { bumpCacheVersions, CACHE_NAMESPACES, readVersionedCache } from '@/worker/cache';
import { recordAuditLog } from '@/worker/services/auditLog';
import { clientIp } from '@/worker/utils/loginRateLimit';
import { extractAuthToken, verifyUserToken } from '@/worker/utils/jwt';

export const settingsRoutes = new Hono<AppContextEnv>();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/gif': 'gif',
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function detectedImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (
    bytes.length > 11 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return { mime: 'image/x-icon', ext: 'ico' };
  return null;
}

function mapSettingsRowToDTO(row: SystemSettingRow): SystemSettingsDTO {
  return {
    id: row.id,
    companyName: row.companyName,
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    startingOrderNumber: row.startingOrderNumber,
    updatedAt: row.updatedAt,
  };
}

function mapPublicSettings(row: SystemSettingRow) {
  return {
    id: row.id,
    companyName: row.companyName,
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    updatedAt: row.updatedAt,
  };
}

async function hasValidSession(c: Context<AppContextEnv>): Promise<boolean> {
  try {
    const token = extractAuthToken(c);
    if (!token) return false;
    const payload = await verifyUserToken(c, token);
    const userId = Number.parseInt(payload?.sub ?? '', 10);
    if (!payload || !Number.isFinite(userId) || typeof payload.tv !== 'number') return false;
    const row = await c.get('db')
      .select({ isActive: users.isActive, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return Boolean(row?.isActive && row.tokenVersion === payload.tv);
  } catch {
    return false;
  }
}

function extractManagedAssetKey(assetUrl: string | null | undefined): string | null {
  if (!assetUrl) return null;
  const prefix = '/api/assets/';
  if (assetUrl.startsWith(prefix)) {
    const key = assetUrl.slice(prefix.length).trim();
    return key.startsWith('branding/') ? key : null;
  }
  return null;
}

async function getOrCreateSingletonSettings(c: {
  get: (key: 'db') => AppContextEnv['Variables']['db'];
}): Promise<SystemSettingRow> {
  const db = c.get('db');
  const current = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, 1))
    .get();

  if (current) {
    return current;
  }

  await db
    .insert(systemSettings)
    .values({
      id: 1,
      companyName: 'نظام إدارة المبيعات',
      logoUrl: null,
      faviconUrl: null,
      startingOrderNumber: 1000,
    })
    .onConflictDoNothing();

  const created = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, 1))
    .get();

  if (!created) {
    throw new Error('تعذر تهيئة إعدادات النظام');
  }
  return created;
}

// Public endpoint so Login screen & White-Labeling hook receive branding on boot
settingsRoutes.get('/', async (c) => {
  const db = c.get('db');
  const authenticated = await hasValidSession(c);
  const settings = await readVersionedCache(db, CACHE_NAMESPACES.settings, authenticated ? 'session' : 'public', async () => {
    const row = await getOrCreateSingletonSettings(c);
    return authenticated ? mapSettingsRowToDTO(row) : mapPublicSettings(row);
  });
  return c.json({ settings });
});

// Admin-only: Update company_name, starting_order_number, or reset logo/favicon URLs
settingsRoutes.put('/', requireAuth, requireAdmin, async (c) => {
  const parsed = await readJson(c, updateSettingsSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const companyName = body.companyName;
  const parsedStartNum = body.startingOrderNumber;

  const current = await getOrCreateSingletonSettings(c);
  const nextLogoUrl =
    body.logoUrl !== undefined ? (body.logoUrl?.trim() || null) : current.logoUrl;
  const nextFaviconUrl =
    body.faviconUrl !== undefined
      ? body.faviconUrl?.trim() || null
      : current.faviconUrl;

  // Clean up old managed R2 object if explicitly removed/replaced
  if (current.logoUrl && current.logoUrl !== nextLogoUrl) {
    const oldKey = extractManagedAssetKey(current.logoUrl);
    if (oldKey) {
      await c.env.BUCKET.delete(oldKey).catch(() => undefined);
    }
  }
  if (current.faviconUrl && current.faviconUrl !== nextFaviconUrl) {
    const oldKey = extractManagedAssetKey(current.faviconUrl);
    if (oldKey) {
      await c.env.BUCKET.delete(oldKey).catch(() => undefined);
    }
  }

  const db = c.get('db');
  const nowIso = new Date().toISOString();

  await db
    .update(systemSettings)
    .set({
      companyName,
      startingOrderNumber: parsedStartNum,
      logoUrl: nextLogoUrl,
      faviconUrl: nextFaviconUrl,
      updatedAt: nowIso,
    })
    .where(eq(systemSettings.id, 1));

  const updated = await getOrCreateSingletonSettings(c);
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'settings',
    action: 'update_settings',
    entityType: 'settings',
    entityId: 1,
    entityLabel: companyName,
    summary: 'تعديل إعدادات النظام',
    details: {
      ...(current.companyName !== companyName ? { companyName: { from: current.companyName, to: companyName } } : {}),
      ...(current.startingOrderNumber !== parsedStartNum ? { startingOrderNumber: { from: current.startingOrderNumber, to: parsedStartNum } } : {}),
      ...(current.logoUrl !== nextLogoUrl ? { logoChanged: true } : {}),
      ...(current.faviconUrl !== nextFaviconUrl ? { faviconChanged: true } : {}),
    },
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  await bumpCacheVersions(db, [CACHE_NAMESPACES.settings, CACHE_NAMESPACES.nextSheet, CACHE_NAMESPACES.dashboard]);
  return c.json({ settings: mapSettingsRowToDTO(updated) });
});

// Admin-only: Upload logo or favicon to Cloudflare R2 and persist URL
settingsRoutes.post('/upload', requireAuth, requireAdmin, async (c) => {
  const declaredLength = Number(c.req.header('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (5 ميجابايت)', code: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'تعذر قراءة الملف المرفوع (Multipart Form Data)' }, 400);
  }

  const rawType = formData.get('type');
  if (rawType !== 'logo' && rawType !== 'favicon') {
    return c.json({ error: 'نوع الملف غير صالح (يجب أن يكون logo أو favicon)' }, 400);
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'يرجى اختيار ملف صورة صالح للرفع' }, 400);
  }

  const file = fileEntry as File;
  if (file.size === 0) {
    return c.json({ error: 'الملف المرفوع فارغ' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'حجم الملف يتجاوز الحد الأقصى المسموح به (5 ميجابايت)' }, 400);
  }

  const buffer = await file.arrayBuffer();
  const detected = detectedImage(new Uint8Array(buffer));
  if (!detected || !ALLOWED_MIME_EXTENSIONS[detected.mime]) {
    return c.json(
      { error: 'صيغة الصورة غير مدعومة. يرجى رفع PNG أو JPG أو WEBP أو GIF أو ICO' },
      400
    );
  }

  const uniqueSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `branding/${rawType}-${uniqueSuffix}.${detected.ext}`;

  await c.env.BUCKET.put(key, buffer, {
    httpMetadata: {
      contentType: detected.mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const current = await getOrCreateSingletonSettings(c);
  const previousUrl = rawType === 'logo' ? current.logoUrl : current.faviconUrl;
  const previousKey = extractManagedAssetKey(previousUrl);
  if (previousKey && previousKey !== key) {
    await c.env.BUCKET.delete(previousKey).catch(() => undefined);
  }

  const publicUrl = `/api/assets/${key}`;
  const db = c.get('db');
  const nowIso = new Date().toISOString();

  await db
    .update(systemSettings)
    .set(
      rawType === 'logo'
        ? { logoUrl: publicUrl, updatedAt: nowIso }
        : { faviconUrl: publicUrl, updatedAt: nowIso }
    )
    .where(eq(systemSettings.id, 1));

  const updated = await getOrCreateSingletonSettings(c);
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'settings',
    action: 'upload_branding',
    entityType: 'settings',
    entityId: 1,
    entityLabel: rawType === 'logo' ? 'شعار الشركة' : 'أيقونة المتصفح',
    summary: rawType === 'logo' ? 'رفع شعار الشركة' : 'رفع أيقونة المتصفح',
    details: { brandingType: rawType, publicUrl },
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  await bumpCacheVersions(db, [CACHE_NAMESPACES.settings]);
  return c.json({
    url: publicUrl,
    key,
    type: rawType,
    settings: mapSettingsRowToDTO(updated),
  });
});
