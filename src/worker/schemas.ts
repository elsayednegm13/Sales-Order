import type { Context } from 'hono';
import { z } from 'zod';

const weightSchema = z
  .union([z.string().trim().max(40), z.number().finite(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return String(value);
    return value.length > 0 ? value : null;
  });

function normalizeDeliveryPhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const western = trimmed.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
    const index = arabic.indexOf(digit);
    return index >= 0 ? String(index % 10) : digit;
  });
  const digits = western.replace(/\D/g, '');
  if (/^1[0125]\d{8}$/.test(digits)) return `0${digits}`;
  return western.trim();
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) return null;
      return value.length > 0 ? value : null;
    });

const quantity = (max: number) =>
  z.coerce.number().int().min(0).max(max).optional().default(0);

const itemTypeSchema = z.enum(['carton', 'bag', 'piece', 'kg']);

export const createProductSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(2).max(120),
    category: z.enum(['blanket', 'heater', 'other']),
    grade: z.enum(['first_grade', 'second_grade']),
    itemType: itemTypeSchema,
    packingCapacity: z.coerce.number().int().min(0).max(100_000).optional().default(0),
    weight: weightSchema,
    isActive: z.boolean().optional(),
  })
  .superRefine((product, ctx) => {
    if ((product.itemType === 'carton' || product.itemType === 'bag') && product.packingCapacity < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packingCapacity'],
        message: 'سعة التعبئة يجب أن تكون رقماً صحيحاً أكبر من صفر',
      });
    }
  });

export const updateProductSchema = z
  .object({
    code: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    category: z.enum(['blanket', 'heater', 'other']).optional(),
    grade: z.enum(['first_grade', 'second_grade']).optional(),
    itemType: itemTypeSchema.optional(),
    packingCapacity: z.coerce.number().int().min(0).max(100_000).optional(),
    weight: z.union([z.string().trim().max(40), z.number().finite(), z.null()]).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((product, ctx) => {
    if (
      product.itemType &&
      (product.itemType === 'carton' || product.itemType === 'bag') &&
      product.packingCapacity !== undefined &&
      product.packingCapacity < 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packingCapacity'],
        message: 'سعة التعبئة يجب أن تكون رقماً صحيحاً أكبر من صفر',
      });
    }
  });

export const createCustomerSchema = z.object({
  clientCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  defaultPhone: optionalText(40),
  defaultLocation: optionalText(160),
  representativeName: optionalText(80),
});

export const updateCustomerSchema = z.object({
  clientCode: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  defaultPhone: z.string().trim().max(40).nullable().optional(),
  defaultLocation: z.string().trim().max(160).nullable().optional(),
  representativeName: optionalText(80),
});

export const createSubMerchantSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  phone: optionalText(40),
  location: optionalText(160),
});

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const productBulkImportSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(2).max(120),
        category: z.enum(['blanket', 'heater', 'other']).nullable().optional(),
        grade: z.enum(['first_grade', 'second_grade']).nullable().optional(),
        itemType: z.enum(['carton', 'bag', 'piece', 'kg']).nullable().optional(),
        packingCapacity: z.number().int().min(0).max(100_000).nullable().optional(),
        weight: z.string().trim().max(40).nullable().optional(),
        isActive: z.boolean().nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
  selectedFields: z.array(z.enum(['category', 'grade', 'itemType', 'packingCapacity', 'weight', 'isActive'])).max(6),
});

export const customerBulkImportSchema = z.object({
  customers: z
    .array(
      z.object({
        clientCode: z.string().trim().min(1).max(40),
        name: z.string().trim().min(2).max(120),
        defaultLocation: nullableText(160),
        defaultPhone: nullableText(40),
        representativeName: nullableText(80),
      }),
    )
    .max(500)
    .default([]),
  subMerchants: z
    .array(
      z.object({
        clientCode: z.string().trim().min(1).max(40),
        name: z.string().trim().min(2).max(120),
        location: nullableText(160),
        phone: nullableText(40),
      }),
    )
    .max(500)
    .default([]),
  selectedCustomerFields: z.array(z.enum(['defaultLocation', 'defaultPhone', 'representativeName'])).max(3),
  selectedMerchantFields: z.array(z.enum(['location', 'phone'])).max(2),
});

export const updateSubMerchantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
});

const permissionGroup = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const userPermissionsSchema = z
  .object({
    dailySheets: permissionGroup({
      view: z.boolean(),
      create: z.boolean(),
      edit: z.boolean(),
      close: z.boolean().optional(),
      archive: z.boolean(),
      delete: z.boolean(),
    }),
    orders: permissionGroup({
      view: z.boolean().optional(),
      create: z.boolean(),
      edit: z.boolean(),
      fulfillment: z.boolean().optional(),
      cancel: z.boolean().optional(),
      delete: z.boolean(),
    }),
    catalog: permissionGroup({
      view: z.boolean(),
      manage: z.boolean(),
      bulkImport: z.boolean().optional(),
      delete: z.boolean().optional(),
    }),
    customers: permissionGroup({
      view: z.boolean(),
      manage: z.boolean(),
      bulkImport: z.boolean().optional(),
      delete: z.boolean().optional(),
      deleteSubMerchant: z.boolean().optional(),
    }),
    reports: permissionGroup({
      view: z.boolean(),
      exportExcel: z.boolean(),
      exportPdf: z.boolean(),
    }),
    users: permissionGroup({ manage: z.boolean() }),
    settings: permissionGroup({ manage: z.boolean() }),
  })
  .strict();

export const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(40),
    password: z.string().min(1).max(128),
  })
  .strict();

export const createUserSchema = z
  .object({
    username: z.string().trim().min(3).max(40),
    password: z.string().min(6).max(128),
    fullName: z.string().trim().min(2).max(100),
    role: z.enum(['admin', 'operator', 'viewer']),
    permissions: userPermissionsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    username: z.string().trim().min(3).max(40).optional(),
    password: z.string().min(6).max(128).optional(),
    fullName: z.string().trim().min(2).max(100).optional(),
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
    permissions: userPermissionsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const BRANDING_ASSET_PATH = /^\/api\/assets\/branding\/[a-zA-Z0-9._-]+$/;

const brandingAssetUrl = z
  .union([z.string().max(500), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!BRANDING_ASSET_PATH.test(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'رابط الشعار يجب أن يكون ملفاً داخلياً من الهوية البصرية',
      });
      return z.NEVER;
    }
    return trimmed;
  });

export const updateSettingsSchema = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    startingOrderNumber: z.number().int().min(1).max(999_999_999),
    logoUrl: brandingAssetUrl,
    faviconUrl: brandingAssetUrl,
  })
  .strict();

const passwordField = z.string().min(6).max(128);

export const passwordResetRequestSchema = z.object({
  username: z.string().trim().min(1).max(40),
}).strict();

export const passwordResetConfirmSchema = z.object({
  mode: z.enum(['employee', 'admin_recovery']),
  username: z.string().trim().min(1).max(40),
  code: z.string().trim().min(1).max(80),
  newPassword: passwordField,
}).strict();

export const regenerateRecoveryCodesSchema = z.object({
  currentPassword: z.string().min(1).max(128),
}).strict();

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'التاريخ غير موجود في التقويم');

export const createDailySheetSchema = z.object({
  sheetNumber: z.string().trim().min(1).max(40).optional(),
  sheetDate: dateSchema.optional(),
  notes: optionalText(500),
});

export const updateDailySheetSchema = z
  .object({
    sheetNumber: z.string().trim().min(1).max(40).optional(),
    sheetDate: dateSchema.optional(),
    status: z.enum(['open', 'closed', 'archived']).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'لا توجد بيانات لتحديثها');

const weightKgField = z.coerce.number().min(0).max(1_000_000).optional().default(0);

export const orderItemSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
    orderMode: z.enum(['carton', 'bag', 'piece', 'kg']),
    cartonsQty: quantity(100_000),
    loosePiecesQty: quantity(1_000_000),
    weightKg: weightKgField,
    notes: z.string().trim().max(160).nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if ((item.orderMode === 'carton' || item.orderMode === 'bag') && item.cartonsQty < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cartonsQty'],
        message: 'كمية الكراتين يجب أن تكون أكبر من صفر',
      });
    }
    if ((item.orderMode === 'piece' || item.orderMode === 'kg') && item.loosePiecesQty < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['loosePiecesQty'],
        message: 'عدد القطع يجب أن يكون أكبر من صفر',
      });
    }
    if (item.orderMode === 'kg' && item.weightKg <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weightKg'],
        message: 'وزن الكيلو يجب أن يكون أكبر من صفر',
      });
    }
  });

const clientOrderFields = {
  customerId: z.coerce.number().int().positive(),
  deliveryType: z.enum(['client_warehouse', 'sub_merchant'] as const),
  subMerchantId: z.coerce.number().int().positive().nullable().optional(),
  recipientName: optionalText(120),
  deliveryPhone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .default('')
    .transform((value) => normalizeDeliveryPhone(value))
    .refine((value) => value.length === 0 || value.length >= 3, {
      message: 'هاتف التسليم يجب أن يكون بين 3 و40 حرفاً عند إدخاله',
    }),
  deliveryLocation: z.string().trim().min(2).max(160),
  trucksCount: z.coerce.number().int().min(1).max(99).optional().default(1),
  representativeName: optionalText(80),
  warehouseRef: optionalText(40),
  notes: optionalText(300),
  items: z.array(orderItemSchema).min(1).max(80),
};

function requireSubMerchant(
  order: { deliveryType: 'client_warehouse' | 'sub_merchant'; subMerchantId?: number | null },
  ctx: z.RefinementCtx
) {
  if (order.deliveryType === 'sub_merchant' && !order.subMerchantId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subMerchantId'],
      message: 'يجب اختيار التاجر الفرعي عند التسليم لتاجر',
    });
  }
}

export const clientOrderSchema = z
  .object({
    dailySheetId: z.coerce.number().int().positive(),
    ...clientOrderFields,
  })
  .superRefine(requireSubMerchant);

export const updateClientOrderSchema = z.object(clientOrderFields).superRefine(requireSubMerchant);

export const fulfillmentStatusSchema = z.object({
  status: z.enum(['pending', 'dispatched', 'cancelled']),
  cancelReason: z.string().trim().max(160).optional(),
});

const FIELD_MESSAGES: Record<string, string> = {
  code: 'كود الصنف غير صالح',
  name: 'الاسم غير صالح',
  packingCapacity: 'سعة التعبئة يجب أن تكون رقماً صحيحاً أكبر من صفر',
  sheetNumber: 'رقم الأوردر يجب أن يكون بين خانة و40 خانة',
  sheetDate: 'تاريخ الأوردر غير صالح',
  deliveryPhone: 'هاتف التسليم يجب أن يكون بين 3 و40 حرفاً عند إدخاله',
  deliveryLocation: 'عنوان التسليم مطلوب',
  cartonsQty: 'كمية الكراتين غير صالحة',
  loosePiecesQty: 'عدد القطع غير صالح',
  weightKg: 'وزن الكيلو غير صالح',
  clientCode: 'كود العميل مطلوب ويجب ألا يتكرر',
  trucksCount: 'عدد السيارات يجب أن يكون 1 على الأقل',
  productId: 'يجب اختيار صنف صالح',
  customerId: 'يجب اختيار عميل',
  items: 'يجب إضافة صنف واحد على الأقل',
  subMerchantId: 'يجب اختيار التاجر الفرعي',
  weight: 'الوزن المرجعي يجب ألا يتجاوز 40 حرفاً',
};

export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'البيانات المرسلة غير صالحة';
  if (issue.message && issue.code === z.ZodIssueCode.custom) return issue.message;
  const field = issue.path[issue.path.length - 1];
  if (field === 'items') {
    if (issue.code === z.ZodIssueCode.too_big) {
      const maximum = 'maximum' in issue ? issue.maximum : undefined;
      if (maximum === 500) return 'الحد الأقصى 500 سطراً في الدفعة الواحدة';
      return 'الحد الأقصى 80 صنفاً في الطلب الواحد';
    }
    if (issue.code === z.ZodIssueCode.too_small) return 'يجب إضافة صنف واحد على الأقل';
  }
  if (typeof field === 'string' && FIELD_MESSAGES[field]) return FIELD_MESSAGES[field];
  return 'البيانات المرسلة غير صالحة';
}

export async function readJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S
): Promise<{ ok: true; data: z.output<S> } | { ok: false; error: string }> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return { ok: false, error: 'صيغة البيانات المرسلة غير صالحة' };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: zodMessage(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed');
}
