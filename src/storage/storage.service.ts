import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import type {
  UploadFileDto,
  GetFileDto,
  UpdateFileDto,
  DeleteFileDto,
  UploadAccountPhotoDto,
  UploadServicePhotoDto,
  UploadSellerOrderPhotoDto,
  UploadBuyerOrderPhotoDto,
} from './dto/upload.dto';
import * as path from 'path';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import {
  generateAccountPhotoPath,
  generateServicePhotoPath,
  generateSellerOrderPhotoPath,
  generateBuyerOrderPhotoPath,
} from './utils/path-helper';

@Injectable()
export class StorageService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Generate random string menggunakan crypto bawaan Node.js
   * @param length Panjang string (default: 16)
   * @returns Random string
   */
  private generateRandomString(length: number = 16): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Kompres gambar menggunakan sharp
   * @param buffer Buffer gambar original
   * @param mimetype MIME type gambar
   * @returns Buffer gambar yang sudah dikompres
   */
  private async compressImage(
    buffer: Buffer,
    mimetype: string,
  ): Promise<Buffer> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      // Tentukan format output berdasarkan mimetype
      let compressed = image;

      // Resize jika gambar terlalu besar (max 1920px width)
      if (metadata.width && metadata.width > 1920) {
        compressed = compressed.resize(1920, null, {
          withoutEnlargement: true,
          fit: 'inside',
        });
      }

      // Kompres sesuai format
      if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
        compressed = compressed.jpeg({ quality: 80, progressive: true });
      } else if (mimetype === 'image/png') {
        compressed = compressed.png({ quality: 80, compressionLevel: 9 });
      } else if (mimetype === 'image/webp') {
        compressed = compressed.webp({ quality: 80 });
      } else if (mimetype === 'image/gif') {
        // GIF tidak dikompres, hanya resize
        compressed = compressed.gif();
      }

      return await compressed.toBuffer();
    } catch (error) {
      // Jika gagal kompres, gunakan buffer original
      console.error('Error compressing image:', error);
      return buffer;
    }
  }

  /**
   * Upload file ke Supabase Storage
   * @param file File yang diupload
   * @param dto DTO dengan bucket dan optional path
   * @returns URL publik dan path file
   */
  async uploadFile(
    file: Express.Multer.File,
    dto: UploadFileDto,
  ): Promise<{ url: string; path: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const bucketName = dto.bucket || 'uploads';
    const timestamp = Date.now();
    const uniqueId = this.generateRandomString();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${timestamp}-${uniqueId}${fileExtension}`;

    // Jika path diberikan, gunakan path tersebut, jika tidak gunakan timestamp-based path
    const filePath = dto.path
      ? `${dto.path}/${fileName}`
      : `${new Date().getFullYear()}/${new Date().getMonth() + 1}/${fileName}`;

    // Kompres gambar sebelum upload
    const compressedBuffer = await this.compressImage(
      file.buffer,
      file.mimetype,
    );

    const result = await this.supabaseService.uploadFile(
      bucketName,
      filePath,
      compressedBuffer,
      file.mimetype,
    );

    return {
      ...result,
      filename: file.originalname,
    };
  }

  /**
   * Get file dari Supabase Storage
   * @param dto DTO dengan bucket dan path
   * @returns File buffer dan content type
   */
  async getFile(dto: GetFileDto): Promise<{
    data: Buffer;
    contentType: string;
    filename: string;
  }> {
    const bucketName = dto.bucket || 'uploads';
    const filePath = dto.path;

    try {
      const result = await this.supabaseService.getFile(bucketName, filePath);
      const filename = path.basename(filePath);

      return {
        ...result,
        filename,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundException('File tidak ditemukan');
      }
      throw error;
    }
  }

  /**
   * Update file di Supabase Storage
   * @param file File baru
   * @param dto DTO dengan bucket dan path
   * @returns URL publik dan path file
   */
  async updateFile(
    file: Express.Multer.File,
    dto: UpdateFileDto,
  ): Promise<{ url: string; path: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const bucketName = dto.bucket || 'uploads';
    const filePath = dto.path;

    // Kompres gambar sebelum update
    const compressedBuffer = await this.compressImage(
      file.buffer,
      file.mimetype,
    );

    const result = await this.supabaseService.updateFile(
      bucketName,
      filePath,
      compressedBuffer,
      file.mimetype,
    );

    return {
      ...result,
      filename: file.originalname,
    };
  }

  /**
   * Delete file dari Supabase Storage
   * @param dto DTO dengan bucket dan path
   * @returns Status sukses
   */
  async deleteFile(dto: DeleteFileDto): Promise<{ success: boolean }> {
    const bucketName = dto.bucket || 'uploads';
    const filePath = dto.path;

    try {
      return await this.supabaseService.deleteFile(bucketName, filePath);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundException('File tidak ditemukan');
      }
      throw error;
    }
  }

  /**
   * Get public URL dari file
   * @param bucketName Nama bucket
   * @param filePath Path file
   * @returns URL publik
   */
  getPublicUrl(bucketName: string, filePath: string): string {
    return this.supabaseService.getPublicUrl(bucketName, filePath);
  }

  /**
   * Upload foto akun
   * Format: [nama-nim]/filename
   */
  async uploadAccountPhoto(
    file: Express.Multer.File,
    dto: UploadAccountPhotoDto,
  ): Promise<{ url: string; path: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const timestamp = Date.now();
    const uniqueId = this.generateRandomString();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${timestamp}-${uniqueId}${fileExtension}`;

    const filePath = generateAccountPhotoPath(
      dto.fullName,
      dto.nim || null,
      fileName,
    );

    // Kompres gambar sebelum upload
    const compressedBuffer = await this.compressImage(
      file.buffer,
      file.mimetype,
    );

    const result = await this.supabaseService.uploadFile(
      dto.bucket,
      filePath,
      compressedBuffer,
      file.mimetype,
    );

    return {
      ...result,
      filename: file.originalname,
    };
  }

  /**
   * Upload foto jasa (penjual)
   * Format: [nama-nim]/penjual/[nama-jasa]/filename
   */
  async uploadServicePhoto(
    file: Express.Multer.File,
    dto: UploadServicePhotoDto,
  ): Promise<{ url: string; path: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const timestamp = Date.now();
    const uniqueId = this.generateRandomString();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${timestamp}-${uniqueId}${fileExtension}`;

    const filePath = generateServicePhotoPath(
      dto.fullName,
      dto.nim || null,
      dto.serviceName,
      fileName,
    );

    // Kompres gambar sebelum upload
    const compressedBuffer = await this.compressImage(
      file.buffer,
      file.mimetype,
    );

    const result = await this.supabaseService.uploadFile(
      dto.bucket,
      filePath,
      compressedBuffer,
      file.mimetype,
    );

    return {
      ...result,
      filename: file.originalname,
    };
  }

  /**
   * Upload foto pesanan penjual
   * Format: [nama-nim]/penjual/[nama-pesanan]/filename
   */
  async uploadSellerOrderPhoto(
    file: Express.Multer.File,
    dto: UploadSellerOrderPhotoDto,
  ): Promise<{ url: string; path: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const timestamp = Date.now();
    const uniqueId = this.generateRandomString();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${timestamp}-${uniqueId}${fileExtension}`;

    const filePath = generateSellerOrderPhotoPath(
      dto.fullName,
      dto.nim || null,
      dto.orderName,
      fileName,
    );

    // Kompres gambar sebelum upload
    const compressedBuffer = await this.compressImage(
      file.buffer,
      file.mimetype,
    );

    const result = await this.supabaseService.uploadFile(
      dto.bucket,
      filePath,
      compressedBuffer,
      file.mimetype,
    );

    return {
      ...result,
      filename: file.originalname,
    };
  }

  /**
   * Upload foto pesanan pembeli
   * Format: [nama-nim]/pembeli/[nama-pesanan]/filename
   */
  async uploadBuyerOrderPhoto(
    file: Express.Multer.File,
    dto: UploadBuyerOrderPhotoDto,
  ): Promise<{ url: string; path: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const timestamp = Date.now();
    const uniqueId = this.generateRandomString();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${timestamp}-${uniqueId}${fileExtension}`;

    const filePath = generateBuyerOrderPhotoPath(
      dto.fullName,
      dto.nim || null,
      dto.orderName,
      fileName,
    );

    // Kompres gambar sebelum upload
    const compressedBuffer = await this.compressImage(
      file.buffer,
      file.mimetype,
    );

    const result = await this.supabaseService.uploadFile(
      dto.bucket,
      filePath,
      compressedBuffer,
      file.mimetype,
    );

    return {
      ...result,
      filename: file.originalname,
    };
  }
}
