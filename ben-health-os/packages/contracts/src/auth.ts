import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

export const MeResponseSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  timeZone: z.string(),
  demoMode: z.boolean(),
  authMode: z.enum(['supabase', 'local']),
  createdAt: IsoDateTimeSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Local-development login only (never enabled when AUTH_MODE=supabase). */
export const DevLoginRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80).optional(),
});

export const DevLoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: IsoDateTimeSchema,
  userId: z.string(),
});

export const ProfileUpdateSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  timeZone: z.string().min(1).max(64).optional(),
  aiSharing: z
    .object({
      enabled: z.boolean().optional(),
      excludedConnectors: z.array(z.string()).optional(),
    })
    .optional(),
});

export const DeleteAllDataRequestSchema = z.object({
  confirmation: z.literal('DELETE ALL MY HEALTH DATA'),
});
