import type { UserDTO, UserRole } from '@/shared/types';
import type { AppDatabase } from '@/db';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS?: Fetcher;
  JWT_SECRET?: string;
  APP_ENV?: string;
  ALLOW_DEV_SEED?: string;
  DEV_SEED_ADMIN_PASSWORD?: string;
}

export interface AuthJwtPayload {
  sub: string;
  username: string;
  role: UserRole;
  tv: number;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export interface AppVariables {
  db: AppDatabase;
  user: UserDTO;
  jwtPayload: AuthJwtPayload;
}

export type AppContextEnv = {
  Bindings: Env;
  Variables: AppVariables;
};
