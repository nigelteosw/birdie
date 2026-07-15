import { z } from 'zod';

const hostedEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must contain at least 32 characters.'),
  BIRDIE_BASE_URL: z.string().url('BIRDIE_BASE_URL must be a valid URL.'),
  BIRDIE_ADMIN_EMAIL: z.string().email('BIRDIE_ADMIN_EMAIL must be a valid email address.'),
  BIRDIE_ADMIN_PASSWORD: z.string().min(12, 'BIRDIE_ADMIN_PASSWORD must contain at least 12 characters.'),
  BIRDIE_ADMIN_NAME: z.string().trim().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(6677),
  MCP_INTERNAL_PORT: z.coerce.number().int().min(1).max(65535).default(6678),
  DB_PATH: z.string().min(1).default('/data/birdie.db'),
  DOMAIN_PROFILE_PATH: z.string().min(1).default('/data/domain.md'),
});

export interface HostedConfig {
  secret: string;
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  port: number;
  mcpInternalPort: number;
  dbPath: string;
  domainPath: string;
}

export function readHostedConfig(env: Record<string, string | undefined> = process.env): HostedConfig {
  const parsed = hostedEnvSchema.parse(env);
  const url = new URL(parsed.BIRDIE_BASE_URL);
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error('BIRDIE_BASE_URL must use HTTPS outside localhost.');
  }

  const adminEmail = parsed.BIRDIE_ADMIN_EMAIL.trim().toLowerCase();
  return {
    secret: parsed.BETTER_AUTH_SECRET,
    baseUrl: url.toString().replace(/\/$/, ''),
    adminEmail,
    adminPassword: parsed.BIRDIE_ADMIN_PASSWORD,
    adminName: parsed.BIRDIE_ADMIN_NAME?.trim() || adminEmail.split('@')[0],
    port: parsed.PORT,
    mcpInternalPort: parsed.MCP_INTERNAL_PORT,
    dbPath: parsed.DB_PATH,
    domainPath: parsed.DOMAIN_PROFILE_PATH,
  };
}
