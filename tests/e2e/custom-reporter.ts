// SPDX-License-Identifier: Apache-2.0
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

class CustomReporter implements Reporter {
  private results: Array<{ name: string; status: 'passed' | 'failed'; duration: number }> = [];
  private startTime: number = 0;

  onBegin() {
    this.startTime = Date.now();
  }

  onTestBegin(test: TestCase) {
    console.log(`\n🧪 ${test.title}`);
  }

  onStdOut(chunk: string | Buffer) {
    // テストスクリプトからのconsole.logをそのまま出力
    process.stdout.write(chunk);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      name: test.title,
      status: result.status === 'passed' ? 'passed' : 'failed',
      duration: result.duration
    });
  }

  onEnd(result: FullResult) {
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 テスト結果サマリー');
    console.log('='.repeat(80));
    
    const passed = this.results.filter(r => r.status === 'passed');
    const failed = this.results.filter(r => r.status === 'failed');
    
    if (passed.length > 0) {
      console.log('\n✅ 合格:');
      passed.forEach(r => {
        console.log(`  ✓ ${r.name}`);
      });
    }
    
    if (failed.length > 0) {
      console.log('\n❌ 不合格:');
      failed.forEach(r => {
        console.log(`  ✗ ${r.name}`);
      });
    }
    
    const total = this.results.length;
    
    console.log('\n' + '-'.repeat(80));
    console.log(`合計: ${total}件 | 合格: ${passed.length}件 | 不合格: ${failed.length}件 | 実行時間: ${totalTime}秒`);
    console.log('='.repeat(80) + '\n');
    
    if (failed.length > 0) {
      console.log('詳細レポート: npx playwright show-report\n');
    }
  }
}

export default CustomReporter;
