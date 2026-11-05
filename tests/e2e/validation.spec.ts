// SPDX-License-Identifier: Apache-2.0
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Modulesで__dirnameを取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// テストケース定義をJSONから読み込み
const testCasesPath = path.join(__dirname, '../fixtures/test-cases.json');
const testCasesData = JSON.parse(fs.readFileSync(testCasesPath, 'utf-8'));

for (const testCase of testCasesData.testCases) {
  test(testCase.name, async ({ page }) => {
    // 1. ページを開く
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 2. JSONデータを読み込み
    const flowDataPath = path.join(__dirname, '../fixtures', testCase.flowDataPath);
    const flowData = JSON.parse(fs.readFileSync(flowDataPath, 'utf-8'));
    
    // 3. ファイルアップロード経由でデータを読み込む（Import JSON）
    const jsonBlob = JSON.stringify(flowData);
    
    // ファイル入力を作成してアップロード
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('button:has-text("Import JSON")').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: testCase.flowDataPath,
      mimeType: 'application/json',
      buffer: Buffer.from(jsonBlob)
    });
    
    // 4. データ読み込み完了を待機（ノードが描画されるまで）
    await page.waitForTimeout(1500);
    
    // 5. 構成チェックボタンをクリック
    const validateButton = page.locator('button:has-text("構成チェック")');
    await validateButton.click();
    
    // 6. ValidationPanelが表示されるまで待機
    // 接続テーブルJSONの非同期読み込みを考慮して、最大10秒待機
    const validationPanel = page.locator('[data-testid="validation-panel"]');
    await validationPanel.waitFor({ state: 'visible', timeout: 10000 });
    
    // ValidationPanelのコンテンツが描画されるまで追加で待機
    await page.waitForTimeout(500);
    
    // 7. ValidationPanelの検証結果を確認
    const errorElements = validationPanel.locator('[data-testid="validation-item-error"]');
    let errorCount = await errorElements.count();
    
    if (errorCount === 0) {
      const altErrorElements = validationPanel.locator('[data-severity="error"]');
      errorCount = await altErrorElements.count();
    }
    
    if (testCase.expectedResult === 'OK') {
      console.log(`  ✓ エラー${errorCount}件 (期待: OK) → ${errorCount === 0 ? '✅ 合格' : '❌ 不合格'}`);
      expect(errorCount).toBe(0);
    } else {
      console.log(`  ✓ エラー${errorCount}件 (期待: NG) → ${errorCount > 0 ? '✅ 合格' : '❌ 不合格'}`);
      expect(errorCount).toBeGreaterThan(0);
    }
  });
}
