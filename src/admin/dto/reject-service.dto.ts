import { z } from 'zod';

export const RejectServiceSchema = z.object({
  reason: z
    .string()
    .nonempty({ message: 'Alasan penolakan wajib diisi' })
    .min(10, { message: 'Alasan penolakan minimal 10 karakter' }),
});

export type RejectServiceDto = z.infer<typeof RejectServiceSchema>;
