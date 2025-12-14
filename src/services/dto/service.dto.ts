import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Schema for creating a new service
export const CreateServiceSchema = z.object({
  title: z
    .string()
    .min(10, { message: 'Judul minimal 10 karakter' })
    .max(100, { message: 'Judul maksimal 100 karakter' }),

  description: z
    .string()
    .min(50, { message: 'Deskripsi minimal 50 karakter' })
    .max(2000, { message: 'Deskripsi maksimal 2000 karakter' }),

  category: z
    .enum([
      'DESIGN',
      'DATA',
      'CODING',
      'WRITING',
      'EVENT',
      'TUTOR',
      'TECHNICAL',
      'OTHER',
    ])
    .describe('Kategori jasa'),

  price: z
    .number()
    .positive({ message: 'Harga harus lebih dari 0' })
    .max(10000000, { message: 'Harga maksimal Rp 10.000.000' }),

  deliveryTime: z
    .number()
    .int()
    .positive({ message: 'Waktu pengerjaan harus lebih dari 0 hari' })
    .max(90, { message: 'Waktu pengerjaan maksimal 90 hari' }),

  revisions: z
    .number()
    .int()
    .min(0, { message: 'Jumlah revisi minimal 0' })
    .max(10, { message: 'Jumlah revisi maksimal 10' })
    .default(1),

  images: z
    .array(z.string().url({ message: 'URL gambar tidak valid' }))
    .min(1, { message: 'Minimal 1 gambar diperlukan' })
    .max(5, { message: 'Maksimal 5 gambar' })
    .optional()
    .default([]),

  // Pricing Details
  pricingType: z
    .enum([
      'FIXED',        // Harga tetap (desain logo, jasa event, dll)
      'PER_PAGE',     // Per halaman (ketik, translate dokumen)
      'PER_WORD',     // Per kata (proofreading, translate)
      'PER_HOUR',     // Per jam (tutor, konsultasi)
      'PER_ITEM',     // Per item (edit foto, desain banner)
      'PER_MINUTE',   // Per menit (edit video, voice over)
      'PER_QUESTION', // Per soal (jasa jawab soal, kerjakan tugas)
      'PER_SLIDE',    // Per slide (PPT design)
      'CUSTOM',       // Custom pricing (dijelaskan di description)
    ])
    .optional()
    .describe('Tipe pricing sesuai jenis jasa'),

  pricePerUnit: z
    .number()
    .positive({ message: 'Harga per unit harus lebih dari 0' })
    .optional()
    .describe('Harga per unit sesuai tipe pricing'),

  minimumOrder: z
    .number()
    .int()
    .positive({ message: 'Minimal order harus lebih dari 0' })
    .optional()
    .describe('Minimal order (misal: minimal 5 halaman, 10 soal, dll)'),

  // Service Details
  requirements: z
    .string()
    .max(1000, { message: 'Requirements maksimal 1000 karakter' })
    .optional()
    .describe('Apa yang perlu disiapkan customer'),

  whatsIncluded: z
    .string()
    .max(1000, { message: 'What\'s included maksimal 1000 karakter' })
    .optional()
    .describe('Apa yang didapat customer'),

  additionalInfo: z
    .string()
    .max(500, { message: 'Additional info maksimal 500 karakter' })
    .optional()
    .describe('Catatan tambahan'),

  // FAQ
  faq: z
    .array(
      z.object({
        question: z.string().min(5).max(200),
        answer: z.string().min(5).max(500),
      }),
    )
    .max(5, { message: 'Maksimal 5 FAQ' })
    .optional()
    .default([])
    .describe('Frequently Asked Questions'),
});

// Schema for updating service
export const UpdateServiceSchema = CreateServiceSchema.partial();

// Schema for filtering/searching services
export const ServiceFilterSchema = z.object({
  q: z.string().optional(),
  category: z
    .enum([
      'DESIGN',
      'DATA',
      'CODING',
      'WRITING',
      'EVENT',
      'TUTOR',
      'TECHNICAL',
      'OTHER',
    ])
    .optional(),
  priceMin: z.coerce.number().positive().optional(), // <-- UBAH DI SINI
  priceMax: z.coerce.number().positive().optional(), // <-- UBAH DI SINI
  ratingMin: z.coerce.number().min(0).max(5).optional(), // <-- UBAH DI SINI
  sellerId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1), // <-- UBAH DI SINI
  limit: z.coerce.number().int().positive().max(50).default(12), // <-- UBAH DI SINI
  sortBy: z
    .enum(['newest', 'price_low', 'price_high', 'rating', 'popular'])
    .default('newest'),
});

export class CreateServiceDto extends createZodDto(CreateServiceSchema) { }
export class UpdateServiceDto extends createZodDto(UpdateServiceSchema) { }
export class ServiceFilterDto extends createZodDto(ServiceFilterSchema) { }

// Ekspor sebagai Tipe (untuk type-hinting di Service)
export type ServiceFilterType = z.infer<typeof ServiceFilterSchema>;
