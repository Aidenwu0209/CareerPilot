import { eq } from 'drizzle-orm';
import { db, dbReady } from './index';
import { users } from './schema';
import {
  DEMO_STUDENT_FINGERPRINT,
  ensureDemoTeacherWorkspace,
  seedDemoUser,
} from './seed-demo';
import { logger } from '@/lib/observability/logger';

async function seed() {
  logger.info('db.seed_started');
  await dbReady;

  const [student] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.fingerprint, DEMO_STUDENT_FINGERPRINT))
    .limit(1);

  if (!student) {
    await seedDemoUser(db);
  } else {
    await ensureDemoTeacherWorkspace(db, student.id);
  }

  logger.info('db.seed_complete');
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('db.seed_failed', { error });
    process.exit(1);
  });
