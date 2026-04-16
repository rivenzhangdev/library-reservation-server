import fs from 'fs';
import path from 'path';

async function run() {
  const testDir = path.resolve(__dirname, '../test');
  const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts'));
  if (files.length === 0) {
    console.log('No test files found.');
    process.exit(0);
  }

  let failures = 0;
  for (const file of files) {
    const filePath = path.resolve(testDir, file);
    console.log(`Running ${file}...`);
    try {
      const module = await import(filePath);
      if (typeof module.runTests === 'function') {
        await module.runTests();
      } else {
        console.warn(`No runTests() exported in ${file}`);
      }
      console.log(`✅ ${file} passed`);
    } catch (error: any) {
      failures += 1;
      console.error(`❌ ${file} failed`);
      console.error(error.stack || error.message || error);
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
