// SPDX-License-Identifier: Apache-2.0
import { FlowSerializable } from '../types/flow';

export function exportAsJson(data: FlowSerializable, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// PNG / SVG エクスポートは後続スプリントで実装予定
