import { eq } from 'drizzle-orm';
import { db, dbReady } from './index';
import { users } from './schema';
import {
  DEMO_STUDENT_FINGERPRINT,
  ensureDemoTeacherWorkspace,
  seedDemoUser,
} from './seed-demo';

async function seed() {
  console.log('Seeding database...');
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

  console.log('Seed complete! Student and teacher demo identities are ready.');
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
