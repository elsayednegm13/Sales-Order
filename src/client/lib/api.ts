import type {
  ApiErrorResponse,
  CreateClientOrderDTO,
  CreateCustomerDTO,
  CreateDailySheetDTO,
  CreateProductDTO,
  CreateSubMerchantDTO,
  CreateUserDTO,
  CustomerDTO,
  DailySheetDetailDTO,
  DailySheetListItemDTO,
  DashboardStatsDTO,
  LoginRequestDTO,
  LoginResponseDTO,
  ProductCategory,
  ProductDTO,
  ProductGrade,
  ReportPeriod,
  SalesReportDTO,
  SubMerchantDTO,
  UpdateClientOrderDTO,
  UpdateDailySheetDTO,
  SystemSettingsDTO,
  UpdateCustomerDTO,
  UpdateProductDTO,
  UpdateSubMerchantDTO,
  UpdateSystemSettingsDTO,
  UpdateUserDTO,
  UploadAssetResponseDTO,
  UserDTO,
} from '@/shared/types';
import { cachedQuery, invalidateQueries } from '@/client/lib/queryCache';

function forgetLegacyToken(): void {
  try {
    localStorage.removeItem('sales_order_jwt');
  } catch {
    // Storage can be unavailable in private mode.
  }
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  forgetLegacyToken();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const signals = [timeout.signal, init.signal].filter((signal): signal is AbortSignal => Boolean(signal));
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  try {
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: 'include',
      signal,
    });

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const errPayload = payload as ApiErrorResponse | null;
      throw new ApiClientError(
        errPayload?.error || 'تعذر إتمام العملية، يرجى المحاولة مرة أخرى',
        response.status,
        errPayload?.code
      );
    }

    return payload as T;
  } catch (error) {
    if (timeout.signal.aborted) {
      throw new ApiClientError('انتهت مهلة الاتصال بالخادم، يرجى المحاولة مرة أخرى', 0, 'TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  auth: {
    async login(credentials: LoginRequestDTO): Promise<LoginResponseDTO> {
      const res = await requestJson<LoginResponseDTO>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      invalidateQueries(['auth:me']);
      return res;
    },

    async logout(): Promise<void> {
      try {
        await requestJson<{ ok: boolean }>('/api/auth/logout', {
          method: 'POST',
        });
      } finally {
        invalidateQueries(['auth:me', 'dashboard', 'sheet', 'sheets', 'products', 'customers', 'settings']);
      }
    },

    async me(force = false): Promise<{ user: UserDTO; nextSheetNumber: string }> {
      return cachedQuery('auth:me', () => requestJson<{ user: UserDTO; nextSheetNumber: string }>('/api/auth/me'), force);
    },
  },

  settings: {
    async get(): Promise<{ settings: SystemSettingsDTO }> {
      return cachedQuery('settings', () => requestJson<{ settings: SystemSettingsDTO }>('/api/settings'));
    },

    async update(data: UpdateSystemSettingsDTO): Promise<{ settings: SystemSettingsDTO }> {
      const result = await requestJson<{ settings: SystemSettingsDTO }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      invalidateQueries(['settings', 'auth:me', 'dashboard']);
      return result;
    },

    async uploadAsset(
      type: 'logo' | 'favicon',
      file: File
    ): Promise<UploadAssetResponseDTO> {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('file', file);
      const result = await requestJson<UploadAssetResponseDTO>('/api/settings/upload', {
        method: 'POST',
        body: formData,
      });
      invalidateQueries(['settings']);
      return result;
    },
  },

  users: {
    async list(): Promise<{ users: UserDTO[] }> {
      return requestJson<{ users: UserDTO[] }>('/api/users');
    },

    async create(data: CreateUserDTO): Promise<{ user: UserDTO }> {
      return requestJson<{ user: UserDTO }>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async update(id: number, data: UpdateUserDTO): Promise<{ user: UserDTO }> {
      return requestJson<{ user: UserDTO }>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    async remove(id: number): Promise<{ ok: boolean; deletedId: number }> {
      return requestJson<{ ok: boolean; deletedId: number }>(`/api/users/${id}`, {
        method: 'DELETE',
      });
    },
  },

  products: {
    async list(params: {
      search?: string;
      category?: ProductCategory | '';
      grade?: ProductGrade | '';
      isActive?: boolean;
      sort?: 'code' | 'created_at';
    } = {}): Promise<{ products: ProductDTO[] }> {
      return cachedQuery(`products:${JSON.stringify(params)}`, () =>
        requestJson(
          withQuery('/api/products', {
            search: params.search,
            category: params.category || undefined,
            grade: params.grade || undefined,
            is_active: params.isActive === undefined ? undefined : String(params.isActive),
            sort: params.sort,
          })
        )
      );
    },

    async create(data: CreateProductDTO): Promise<{ product: ProductDTO }> {
      const result = await requestJson<{ product: ProductDTO }>('/api/products', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateQueries(['products', 'dashboard']);
      return result;
    },

    async update(id: number, data: UpdateProductDTO): Promise<{ product: ProductDTO }> {
      const result = await requestJson<{ product: ProductDTO }>(`/api/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      invalidateQueries(['products', 'dashboard']);
      return result;
    },

    async remove(id: number): Promise<{ ok: boolean; deletedId: number }> {
      const result = await requestJson<{ ok: boolean; deletedId: number }>(`/api/products/${id}`, { method: 'DELETE' });
      invalidateQueries(['products', 'dashboard']);
      return result;
    },

    async bulkImport(data: {
      items: Array<{
        code: string;
        name: string;
        category?: 'blanket' | 'heater' | 'other' | null;
        grade?: 'first_grade' | 'second_grade' | null;
        itemType?: string | null;
        packingCapacity?: number | null;
        weight?: string | null;
        isActive?: boolean | null;
      }>;
      selectedFields: Array<'category' | 'grade' | 'itemType' | 'packingCapacity' | 'weight' | 'isActive'>;
    }): Promise<{ created: number; updated: number; errors: Array<{ code: string; message: string }> }> {
      const result = await requestJson<{ created: number; updated: number; errors: Array<{ code: string; message: string }> }>('/api/products/bulk-import', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateQueries(['products', 'dashboard', 'reports']);
      return result;
    },
  },

  customers: {
    async list(params: { search?: string; includeSubMerchants?: boolean } = {}): Promise<{
      customers: CustomerDTO[];
    }> {
      return cachedQuery(`customers:${JSON.stringify(params)}`, () =>
        requestJson(
          withQuery('/api/customers', {
            search: params.search,
            include: params.includeSubMerchants ? 'sub_merchants' : undefined,
          })
        )
      );
    },

    async create(data: CreateCustomerDTO): Promise<{ customer: CustomerDTO }> {
      const result = await requestJson<{ customer: CustomerDTO }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateQueries(['customers', 'dashboard']);
      return result;
    },

    async update(id: number, data: UpdateCustomerDTO): Promise<{ customer: CustomerDTO }> {
      const result = await requestJson<{ customer: CustomerDTO }>(`/api/customers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      invalidateQueries(['customers', 'dashboard']);
      return result;
    },

    async remove(id: number): Promise<{ ok: boolean; deletedId: number }> {
      const result = await requestJson<{ ok: boolean; deletedId: number }>(`/api/customers/${id}`, { method: 'DELETE' });
      invalidateQueries(['customers', 'dashboard']);
      return result;
    },

    async subMerchants(customerId: number): Promise<{ subMerchants: SubMerchantDTO[] }> {
      return requestJson(`/api/customers/${customerId}/sub-merchants`);
    },

    async bulkImport(data: {
      customers: Array<{ clientCode: string; name: string; defaultLocation?: string | null; defaultPhone?: string | null; representativeName?: string | null }>;
      subMerchants: Array<{ clientCode: string; name: string; location?: string | null; phone?: string | null }>;
      selectedCustomerFields: Array<'defaultLocation' | 'defaultPhone' | 'representativeName'>;
      selectedMerchantFields: Array<'location' | 'phone'>;
    }): Promise<{ created: number; updated: number; errors: Array<{ code: string; message: string }> }> {
      const result = await requestJson<{ created: number; updated: number; errors: Array<{ code: string; message: string }> }>('/api/customers/bulk-import', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateQueries(['customers', 'dashboard', 'reports']);
      return result;
    },
  },

  subMerchants: {
    async create(data: CreateSubMerchantDTO): Promise<{ subMerchant: SubMerchantDTO }> {
      const result = await requestJson<{ subMerchant: SubMerchantDTO }>('/api/sub-merchants', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateQueries(['customers', 'dashboard']);
      return result;
    },

    async update(id: number, data: UpdateSubMerchantDTO): Promise<{ subMerchant: SubMerchantDTO }> {
      const result = await requestJson<{ subMerchant: SubMerchantDTO }>(`/api/sub-merchants/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      invalidateQueries(['customers', 'dashboard']);
      return result;
    },

    async remove(id: number): Promise<{ ok: boolean; deletedId: number }> {
      const result = await requestJson<{ ok: boolean; deletedId: number }>(`/api/sub-merchants/${id}`, { method: 'DELETE' });
      invalidateQueries(['customers', 'dashboard']);
      return result;
    },
  },

  reports: {
    async get(params: {
      period: ReportPeriod;
      date?: string;
      month?: string;
      year?: string;
      from?: string;
      to?: string;
      customerId?: string;
      productId?: string;
      deliveryType?: 'all' | 'warehouse' | 'sub_merchant';
      status?: 'all' | 'open' | 'closed';
    }): Promise<{ report: SalesReportDTO }> {
      return cachedQuery(`reports:${JSON.stringify(params)}`, () =>
        requestJson(withQuery('/api/reports', {
          period: params.period,
          date: params.date,
          month: params.month,
          year: params.year,
          from: params.from,
          to: params.to,
          customerId: params.customerId,
          productId: params.productId,
          deliveryType: params.deliveryType && params.deliveryType !== 'all' ? params.deliveryType : undefined,
          status: params.status && params.status !== 'all' ? params.status : undefined,
        }))
      );
    },
  },

  dashboard: {
    async stats(): Promise<{ stats: DashboardStatsDTO }> {
      return cachedQuery('dashboard', () => requestJson('/api/dashboard/stats'));
    },
  },

  dailySheets: {
    async list(params: { status?: 'open' | 'closed' | 'archived' | ''; page?: number; pageSize?: number; search?: string } = {}): Promise<{
      sheets: DailySheetListItemDTO[];
      page: number;
      pageSize: number;
      total: number;
      nextSheetNumber: string;
    }> {
      return cachedQuery(`sheets:${JSON.stringify(params)}`, () =>
        requestJson(
          withQuery('/api/daily-sheets', {
            status: params.status || undefined,
            search: params.search || undefined,
            page: params.page ? String(params.page) : undefined,
            pageSize: params.pageSize ? String(params.pageSize) : undefined,
          })
        )
      );
    },

    async create(data: CreateDailySheetDTO): Promise<{ sheet: DailySheetListItemDTO }> {
      const result = await requestJson<{ sheet: DailySheetListItemDTO }>('/api/daily-sheets', { method: 'POST', body: JSON.stringify(data) });
      invalidateQueries(['sheets', 'sheet', 'dashboard', 'reports', 'auth:me']);
      return result;
    },

    async get(id: number): Promise<{ sheet: DailySheetDetailDTO }> {
      return cachedQuery(`sheet:${id}`, () => requestJson(`/api/daily-sheets/${id}`));
    },

    async update(id: number, data: UpdateDailySheetDTO): Promise<{ sheet: DailySheetListItemDTO }> {
      const result = await requestJson<{ sheet: DailySheetListItemDTO }>(`/api/daily-sheets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      invalidateQueries(['sheets', 'sheet', 'dashboard', 'reports', 'auth:me']);
      return result;
    },

    async remove(id: number): Promise<{ ok: boolean; deletedId: number }> {
      const result = await requestJson<{ ok: boolean; deletedId: number }>(`/api/daily-sheets/${id}`, { method: 'DELETE' });
      invalidateQueries(['sheets', 'sheet', 'dashboard', 'reports', 'auth:me']);
      return result;
    },
  },

  dailyOrders: {
    async create(data: CreateClientOrderDTO): Promise<{ orderId: number; dailySheetId: number }> {
      const result = await requestJson<{ orderId: number; dailySheetId: number }>('/api/daily-orders', { method: 'POST', body: JSON.stringify(data) });
      invalidateQueries(['sheet', 'sheets', 'dashboard', 'reports']);
      return result;
    },

    async update(orderId: number, data: UpdateClientOrderDTO): Promise<{ orderId: number; dailySheetId: number }> {
      const result = await requestJson<{ orderId: number; dailySheetId: number }>(`/api/daily-orders/${orderId}`, { method: 'PUT', body: JSON.stringify(data) });
      invalidateQueries(['sheet', 'sheets', 'dashboard', 'reports']);
      return result;
    },

    async remove(orderId: number): Promise<{ ok: boolean; deletedId: number }> {
      const result = await requestJson<{ ok: boolean; deletedId: number }>(`/api/daily-orders/${orderId}`, { method: 'DELETE' });
      invalidateQueries(['sheet', 'sheets', 'dashboard', 'reports']);
      return result;
    },
  },
};
