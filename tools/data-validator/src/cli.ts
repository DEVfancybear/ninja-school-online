import { fileURLToPath } from 'node:url';
import { validateGameData } from './validate.js';

// Mặc định là game-data ở gốc repo (đường dẫn này đúng cho cả src/ khi chạy tsx và dist/ sau khi build).
const defaultTarget = fileURLToPath(new URL('../../../game-data', import.meta.url));
const target = process.argv[2] ?? defaultTarget;
const { checked, errors } = await validateGameData(target);

if (errors.length > 0) {
  console.error(`Không hợp lệ: ${errors.length} lỗi trong ${checked} file tại ${target}`);
  for (const error of errors) {
    console.error(`  ${error.file}${error.path ? ` [${error.path}]` : ''}: ${error.message}`);
  }
  process.exit(1);
}

console.log(`Hợp lệ: đã kiểm ${checked} file tại ${target}`);
