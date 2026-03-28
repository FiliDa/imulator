import { z } from 'zod';

export const TextSchema = z.object({
  text: z.string().min(1),
  context: z.string().optional()
});

export const TextImageSchemaJson = z.object({
  text: z.string().optional(),
  images: z.array(z.string()).optional(),
  context: z.string().optional()
});

export const ImageSchemaJson = z.object({
  images: z.array(z.string()).min(1),
  context: z.string().optional()
});

export function validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error?.issues?.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') || 'invalid';
    const err = new Error(msg);
    err.status = 400;
    throw err;
  }
  return r.data;
}