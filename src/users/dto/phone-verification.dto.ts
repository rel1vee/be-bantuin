import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RequestPhoneVerificationSchema = z.object({
    phoneNumber: z
        .string()
        .nonempty({ message: 'Nomor telepon wajib diisi' })
        .regex(/^(\+62|62|0)[0-9]{9,12}$/, {
            message: 'Format nomor telepon tidak valid',
        }),
});

export class RequestPhoneVerificationDto extends createZodDto(RequestPhoneVerificationSchema) { }

export const VerifyPhoneSchema = z.object({
    otp: z
        .string()
        .length(6, { message: 'OTP harus 6 digit' }),
});

export class VerifyPhoneDto extends createZodDto(VerifyPhoneSchema) { }
