// Node coi thư mục là CommonJS nếu có package.json khai báo type: commonjs.
// Cần thiết để các công cụ CJS (drizzle-kit, script cũ) require được @ninja/shared.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
await writeFile(
  join(packageRoot, 'dist-cjs', 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);
