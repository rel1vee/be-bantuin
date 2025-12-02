import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: ReturnType<typeof createClient>;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY', // Ambil kunci dari ENV
    );

    if (!supabaseUrl || !supabaseKey) {
      throw new InternalServerErrorException(
        'Supabase credentials are not configured',
      );
    }

    // Inisialisasi klien Supabase
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Memeriksa apakah bucket sudah ada
   * @param bucketName Nama bucket
   * @returns true jika bucket ada, false jika tidak
   */
  async bucketExists(bucketName: string): Promise<boolean> {
    const { data, error } = await this.supabase.storage.getBucket(bucketName);
    return !error && data !== null;
  }

  /**
   * Membuat bucket baru jika belum ada
   * @param bucketName Nama bucket
   * @param isPublic Apakah bucket public (default: true)
   * @returns true jika berhasil dibuat atau sudah ada
   */
  async createBucketIfNotExists(
    bucketName: string,
    isPublic: boolean = true,
  ): Promise<boolean> {
    // Cek apakah bucket sudah ada
    const exists = await this.bucketExists(bucketName);
    if (exists) {
      return true;
    }

    // Buat bucket baru
    const { error } = await this.supabase.storage.createBucket(bucketName, {
      public: isPublic,
      fileSizeLimit: 52428800, // 50MB
      allowedMimeTypes: null, // Allow all file types
    });

    if (error) {
      console.error('Supabase Create Bucket Error:', error);
      throw new InternalServerErrorException(
        `Gagal membuat bucket: ${error.message}`,
      );
    }

    return true;
  }

  /**
   * Mengunggah file ke bucket tertentu
   * @param bucketName Nama bucket di Supabase Storage
   * @param filePath Path lengkap file di dalam bucket (termasuk nama file)
   * @param file Buffer/Blob file
   * @param fileType MIME type file
   * @returns URL publik file
   */
  async uploadFile(
    bucketName: string,
    filePath: string,
    fileBuffer: Buffer,
    fileType: string,
  ): Promise<{ url: string; path: string }> {
    // Pastikan bucket ada sebelum upload
    await this.createBucketIfNotExists(bucketName, true);

    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .upload(filePath, fileBuffer, {
        contentType: fileType,
        upsert: false, // Set false jika tidak ingin menimpa file
      });

    if (error) {
      console.error('Supabase Upload Error:', error);
      throw new InternalServerErrorException(
        `Gagal mengunggah file: ${error.message}`,
      );
    }

    // Dapatkan URL publik
    const { data: publicUrlData } = this.supabase.storage
      .from(bucketName)
      .getPublicUrl(data.path);

    if (!publicUrlData) {
      throw new InternalServerErrorException('Gagal mendapatkan URL publik');
    }

    return {
      url: publicUrlData.publicUrl,
      path: data.path,
    };
  }

  /**
   * Mengambil file dari bucket tertentu
   * @param bucketName Nama bucket di Supabase Storage
   * @param filePath Path file di dalam bucket
   * @returns Buffer file dan metadata
   */
  async getFile(
    bucketName: string,
    filePath: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    // Cek apakah bucket ada
    const exists = await this.bucketExists(bucketName);
    if (!exists) {
      throw new InternalServerErrorException(
        `Bucket '${bucketName}' tidak ditemukan`,
      );
    }

    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .download(filePath);

    if (error) {
      console.error('Supabase Get File Error:', error);
      throw new InternalServerErrorException(
        `Gagal mengambil file: ${error.message}`,
      );
    }

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Infer content type dari file extension
    const contentType = this.getContentTypeFromPath(filePath);

    return {
      data: buffer,
      contentType,
    };
  }

  /**
   * Mendapatkan content type dari file path berdasarkan extension
   */
  private getContentTypeFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      pdf: 'application/pdf',
    };

    return ext && contentTypes[ext]
      ? contentTypes[ext]
      : 'application/octet-stream';
  }

  /**
   * Mengupdate file di bucket tertentu
   * @param bucketName Nama bucket di Supabase Storage
   * @param filePath Path file di dalam bucket
   * @param fileBuffer Buffer file baru
   * @param fileType MIME type file
   * @returns URL publik file
   */
  async updateFile(
    bucketName: string,
    filePath: string,
    fileBuffer: Buffer,
    fileType: string,
  ): Promise<{ url: string; path: string }> {
    // Pastikan bucket ada sebelum update
    await this.createBucketIfNotExists(bucketName, true);

    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .update(filePath, fileBuffer, {
        contentType: fileType,
        upsert: true, // Upsert untuk update atau create jika tidak ada
      });

    if (error) {
      console.error('Supabase Update File Error:', error);
      throw new InternalServerErrorException(
        `Gagal mengupdate file: ${error.message}`,
      );
    }

    // Dapatkan URL publik
    const { data: publicUrlData } = this.supabase.storage
      .from(bucketName)
      .getPublicUrl(data.path);

    if (!publicUrlData) {
      throw new InternalServerErrorException('Gagal mendapatkan URL publik');
    }

    return {
      url: publicUrlData.publicUrl,
      path: data.path,
    };
  }

  /**
   * Menghapus file dari bucket tertentu
   * @param bucketName Nama bucket di Supabase Storage
   * @param filePath Path file di dalam bucket
   * @returns Status sukses
   */
  async deleteFile(
    bucketName: string,
    filePath: string,
  ): Promise<{ success: boolean }> {
    // Cek apakah bucket ada
    const exists = await this.bucketExists(bucketName);
    if (!exists) {
      throw new InternalServerErrorException(
        `Bucket '${bucketName}' tidak ditemukan`,
      );
    }

    const { error } = await this.supabase.storage
      .from(bucketName)
      .remove([filePath]);

    if (error) {
      console.error('Supabase Delete File Error:', error);
      throw new InternalServerErrorException(
        `Gagal menghapus file: ${error.message}`,
      );
    }

    return { success: true };
  }

  /**
   * Mendapatkan URL publik file
   * @param bucketName Nama bucket di Supabase Storage
   * @param filePath Path file di dalam bucket
   * @returns URL publik
   */
  getPublicUrl(bucketName: string, filePath: string): string {
    const { data } = this.supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }
}
