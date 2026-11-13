import { z } from 'zod';
export const mapSettingsSchema = z.object({
  fontFamily: z.enum(['Arial','system-ui','Manrope']).default('Arial'),
  fontSize: z.number().int().min(12).max(28).default(18),
  markerSize: z.number().int().min(32).max(72).default(44),
  clusterRadius: z.number().int().min(0).max(120).default(56),
});
export type MapSettings = z.infer<typeof mapSettingsSchema>;
export const defaultMapSettings = mapSettingsSchema.parse({});
