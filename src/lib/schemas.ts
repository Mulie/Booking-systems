import { z } from "zod";

export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  durationMin: z.number().int().min(5).max(480),
  bufferMin: z.number().int().min(0).max(120).default(0),
  price: z.number().min(0).max(10000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const barberSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(500).default(""),
  photoUrl: z.string().url().max(500).nullable().optional(),
  active: z.boolean().default(true),
  bufferMin: z.number().int().min(0).max(60).default(0),
  googleCalendarId: z.string().trim().max(300).nullable().optional(),
  googleBusySync: z.boolean().default(false),
  serviceIds: z.array(z.string().uuid()).optional(),
});
