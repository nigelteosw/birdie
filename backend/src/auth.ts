import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { admin, jwt } from 'better-auth/plugins';
import type { HostedConfig } from './runtimeConfig.js';

const oauthScopes: ['openid', 'profile', 'email', 'offline_access', 'birdie:read', 'birdie:write'] = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'birdie:read',
  'birdie:write',
];

export function createBirdieAuth(config: HostedConfig) {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const database = new Database(config.dbPath);
  const auth = betterAuth({
    appName: 'Birdie',
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    secret: config.secret,
    database,
    trustedOrigins: [config.baseUrl],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    advanced: {
      cookiePrefix: 'birdie',
      database: { generateId: 'uuid' },
    },
    plugins: [
      admin(),
      jwt(),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        scopes: oauthScopes,
        validAudiences: [`${config.baseUrl}/mcp`],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: oauthScopes,
        clientRegistrationAllowedScopes: oauthScopes,
        silenceWarnings: { oauthAuthServerConfig: true },
      }),
    ],
  });

  return { auth, database };
}

export type BirdieAuthRuntime = ReturnType<typeof createBirdieAuth>;
export type BirdieAuth = BirdieAuthRuntime['auth'];
