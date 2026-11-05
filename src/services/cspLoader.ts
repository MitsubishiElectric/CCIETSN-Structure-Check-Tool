// SPDX-License-Identifier: Apache-2.0
import { CspIndex, CspDeviceSummary, isCspIndex } from '../types/csp';

/**
 * CSP インデックス読み込み（メモリキャッシュ）
 * - 初回のみ fetch
 * - 失敗時: 例外throw (UI側でトースト等ハンドリング想定)
 */
let indexPromise: Promise<CspIndex> | null = null;

export function loadCspIndex(): Promise<CspIndex> {
  if (!indexPromise) {
  // Vite 環境の型補完が tsconfig 側で未設定の場合でもコンパイルを通すため any キャスト
  const baseUrl = (import.meta as any).env?.BASE_URL ?? './';
  indexPromise = fetch(baseUrl + 'csp/csp-index.json', { cache: 'no-cache' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to fetch csp-index.json: ' + r.status);
        const data = await r.json();
        if (!isCspIndex(data)) throw new Error('Invalid CSP index schema');
        const idx = data as CspIndex;
        // 1) TSN対応のみ保持
        const tsn = idx.devices.filter(d => d.commIfTypeId === 'CCLinkIETSN');
        // 2) 同一 modelName が複数ある場合は ja を含むID優先
        const byModel: Map<string, CspDeviceSummary[]> = new Map();
        for (const dev of tsn) {
          const list = byModel.get(dev.modelName) || [];
          list.push(dev);
          byModel.set(dev.modelName, list);
        }
        const preferred: CspDeviceSummary[] = [];
        const jaRegex = /(^|[_-])ja([._-]|$)/i; // _ja. _ja_ -ja- etc
        for (const [model, list] of byModel.entries()) {
          // まず ja を含む id の候補
          const jaCandidate = list.find(d => jaRegex.test(d.id));
          preferred.push(jaCandidate || list[0]);
        }
        // 並びは元の modelName 挿入順にする（Map iteration は挿入順）
        idx.devices = preferred;
        // 3) ソート規則（任意）: modelName 昇順で安定表示
        idx.devices.sort((a, b) => a.modelName.localeCompare(b.modelName, 'ja'));
        return idx;
      })
      .catch(err => {
        // 失敗した場合は次回再試行できるようキャッシュを破棄
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

/** インデックスからIDでサマリを探す（未ロードなら内部でロード） */
export async function findDeviceSummary(id: string): Promise<CspDeviceSummary | undefined> {
  const idx = await loadCspIndex();
  return idx.devices.find(d => d.id === id);
}

/** 簡易検索: 部分一致 (modelName, id) */
export async function searchDevices(keyword: string): Promise<CspDeviceSummary[]> {
  const kw = keyword.trim().toLowerCase();
  const idx = await loadCspIndex();
  if (!kw) return idx.devices;
  return idx.devices.filter(d => d.modelName.toLowerCase().includes(kw) || d.id.toLowerCase().includes(kw));
}
