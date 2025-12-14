import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateProfileSchema = z.object({
    bio: z.string().optional(),
    fullName: z.string().min(3).optional(),
    profilePicture: z.string().optional(),
});

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) { }
