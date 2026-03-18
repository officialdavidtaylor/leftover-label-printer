import { z } from 'zod';

export const authSessionSchema = z.object({
  userId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  idToken: z.string().trim().min(1).optional(),
  expiresAt: z.number().int().positive(),
  roles: z.array(z.string().trim().min(1)).min(1),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
});

export type AuthSession = z.infer<typeof authSessionSchema>;

export function isSessionExpired(session: AuthSession, now = Math.floor(Date.now() / 1000)): boolean {
  return session.expiresAt <= now;
}
