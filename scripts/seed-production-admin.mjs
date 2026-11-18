import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_NAME = 'sales-order-db';
const ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2_sha256';

const ADMIN_PERMISSIONS = JSON.stringify({
  dailySheets: { view: true, create: true, edit: true, archive: true },
  orders: { view: true, create: true, edit: true, delete: true },
  catalog: { view: true, manage: true },
  customers: { view: true, manage: true },
  reports: { view: true, exportExcel: true, exportPdf: true },
  users: { manage: true },
  settings: { manage: true },
});

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return `${HASH_PREFIX}$${ITERATIONS}$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

function temporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString('base64url');
}

function buildSql(passwordHash) {
  return `-- Production bootstrap only: system identity and the first admin.
-- No catalog, customers, sheets, or orders are inserted.
-- Safe to run again. Existing rows are left unchanged.

INSERT INTO system_settings (id, company_name, logo_url, favicon_url, starting_order_number)
VALUES (1, 'نظام إدارة المبيعات', NULL, NULL, 1000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO users (username, password_hash, full_name, role, permissions, is_active, token_version)
VALUES (
  'admin',
  ${sqlString(passwordHash)},
  'مدير النظام',
  'admin',
  ${sqlString(ADMIN_PERMISSIONS)},
  1,
  1
)
ON CONFLICT(username) DO NOTHING;
`;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const password = process.env.SEED_ADMIN_PASSWORD?.trim() || temporaryPassword();

if (password.length < 16) {
  console.error('SEED_ADMIN_PASSWORD must be at least 16 characters.');
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const sql = buildSql(passwordHash);
const backupDir = join(repoRoot, 'backups');
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const output = join(backupDir, `seed-production-admin-${stamp}.sql`);
writeFileSync(output, sql, 'utf8');

console.log(`Wrote ${output}`);
console.log('Temporary admin username: admin');
console.log(`Temporary admin password: ${password}`);
console.log('Change this password immediately after the first production login.');

if (!apply) {
  console.log(`Review the SQL, then apply it with: node scripts/seed-production-admin.mjs --apply`);
  console.log('Running this script again generates a new password file. It does not replace an existing admin.');
  process.exit(0);
}

const result = spawnSync(
  'npx',
  ['wrangler', 'd1', 'execute', DB_NAME, '--remote', `--file=${output}`],
  { cwd: repoRoot, stdio: 'inherit', shell: true },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
