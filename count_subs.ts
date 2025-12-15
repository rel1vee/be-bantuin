import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // Cast to any because the client might not be fully updated in IDE types but generated in FS
    const count = await (prisma as any).pushSubscription.count();
    console.log('Subscriptions:', count);
  } catch (e: any) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
