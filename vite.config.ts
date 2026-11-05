// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 環境変数 VITE_BASE_PATH があればそれを使用。無ければ相対パス('./')。
// 相対パス化により任意のサブパス / ドメインで配置可能 (GitHub Pages のランダムURL含む)。
// 例: 本来の固定URL運用時は VITE_BASE_PATH=/CCIETSN-Structure-Check-Tool/ を指定。
const basePath = process.env.VITE_BASE_PATH ?? './';

export default defineConfig({
  base: basePath,
  plugins: [react()],
  build: {
    target: 'es2018',
    sourcemap: true,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.json')) {
            // JSONファイルは data ディレクトリに配置
            return `data/[name]-[hash][extname]`;
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  // 開発サーバーの設定：src/data配下をそのまま配信
  server: {
    middlewares: []
  }
});
