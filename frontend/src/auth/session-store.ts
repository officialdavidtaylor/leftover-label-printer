import { z } from 'zod';

const persistedSessionSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string().trim().min(1),
  expiresAtEpochMs: z.number().int().positive(),
});

export type AuthSession = z.infer<typeof persistedSessionSchema>;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const DEFAULT_SESSION_STORAGE_KEY = 'leftover-label-printer.oidc.session';

export class SessionStore {
  constructor(
    private readonly storage: StorageLike,
    private readonly storageKey: string = DEFAULT_SESSION_STORAGE_KEY
  ) {}

  save(input: { accessToken: string; tokenType: string; expiresInSeconds: number; nowMs?: number }): AuthSession {
    const nowMs = input.nowMs ?? Date.now();
    const session: AuthSession = {
      accessToken: input.accessToken,
      tokenType: input.tokenType,
      expiresAtEpochMs: nowMs + input.expiresInSeconds * 1000,
    };

    this.storage.setItem(this.storageKey, JSON.stringify(session));
    return session;
  }

  read(nowMs: number = Date.now()): AuthSession | null {
    const rawValue = this.storage.getItem(this.storageKey);
    if (rawValue === null) {
      return null;
    }

    try {
      const parsed = persistedSessionSchema.parse(JSON.parse(rawValue));
      if (parsed.expiresAtEpochMs <= nowMs) {
        this.clear();
        return null;
      }
      return parsed;
    } catch {
      this.clear();
      return null;
    }
  }

  clear(): void {
    this.storage.removeItem(this.storageKey);
  }
}
