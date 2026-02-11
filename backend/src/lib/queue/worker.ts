import { connectToDatabase } from '@/lib/db/mongoose';
import { registerAlignmentProcessor } from './alignment-queue';

async function bootstrap() {
  await connectToDatabase();
  registerAlignmentProcessor();
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
