// Run: cd /home/z/my-project && bun run scripts/seed-multi.ts
import { seedDatabase } from '../src/lib/seed';

async function main() {
  try {
    const result = await seedDatabase();
    console.log('\n📋 SEED RESULT:');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

main();
