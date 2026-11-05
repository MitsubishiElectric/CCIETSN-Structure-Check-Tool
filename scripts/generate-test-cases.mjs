#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, '../tests/fixtures');
const outputPath = path.join(fixturesDir, 'test-cases.json');

// fixtures/内のJSONファイルを取得（test-cases.json以外）
const jsonFiles = fs.readdirSync(fixturesDir)
  .filter(file => file.endsWith('.json') && file !== 'test-cases.json')
  .sort();

const testCases = jsonFiles.map((file, index) => {
  const fileName = file.replace('.json', '');
  
  // ファイル名から期待値を推測
  let expectedResult = 'OK';
  
  if (fileName.startsWith('ng-') || fileName.startsWith('error-')) {
    expectedResult = 'NG';
  }
  
  return {
    id: `test-${String(index + 1).padStart(3, '0')}`,
    name: file,
    flowDataPath: `./${file}`,
    expectedResult
  };
});

const output = {
  testCases
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log('✅ test-cases.json を生成しました');
console.log(`   テストケース数: ${testCases.length}`);
testCases.forEach(tc => {
  console.log(`   - ${tc.id}: ${tc.name} (${tc.expectedResult})`);
});
