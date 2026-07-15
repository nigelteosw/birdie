import { getMigrations } from 'better-auth/db/migration';
import type { BirdieAuthRuntime } from './auth.js';
import type { HostedConfig } from './runtimeConfig.js';

export interface BootstrapUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
}

export interface AdminBootstrapStore {
  findByEmail(email: string): BootstrapUser | undefined | Promise<BootstrapUser | undefined>;
  createUser(input: { email: string; password: string; name: string; role: 'admin' }): Promise<BootstrapUser>;
  setRole(userId: string, role: 'admin'): BootstrapUser | Promise<BootstrapUser>;
}

export async function bootstrapAdmin(store: AdminBootstrapStore, config: HostedConfig) {
  const existing = await store.findByEmail(config.adminEmail);
  if (!existing) {
    return {
      created: true,
      user: await store.createUser({
        email: config.adminEmail,
        password: config.adminPassword,
        name: config.adminName,
        role: 'admin',
      }),
    };
  }
  if (existing.role !== 'admin') {
    return { created: false, user: await store.setRole(existing.id, 'admin') };
  }
  return { created: false, user: existing };
}

export async function initializeAuth(runtime: BirdieAuthRuntime, config: HostedConfig) {
  const { runMigrations } = await getMigrations(runtime.auth.options);
  await runMigrations();

  const store: AdminBootstrapStore = {
    findByEmail(email) {
      return runtime.database
        .query<BootstrapUser, [string]>('SELECT id, email, name, role FROM user WHERE lower(email) = lower(?)')
        .get(email) ?? undefined;
    },
    async createUser(input) {
      const result = await runtime.auth.api.createUser({ body: input });
      return result.user;
    },
    setRole(userId, role) {
      runtime.database
        .query('UPDATE user SET role = ?, updatedAt = ? WHERE id = ?')
        .run(role, new Date().toISOString(), userId);
      const user = runtime.database.query<BootstrapUser, [string]>('SELECT id, email, name, role FROM user WHERE id = ?').get(userId);
      if (!user) throw new Error('Bootstrapped admin user disappeared during role update.');
      return user;
    },
  };

  return bootstrapAdmin(store, config);
}
