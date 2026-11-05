// SPDX-License-Identifier: Apache-2.0
import { FlowSerializable } from '../types/flow';

const KEY_PREFIX = 'flowchart:';

function buildKey(key: string) {
  return KEY_PREFIX + key;
}

export const storage = {
  save(key: string, data: FlowSerializable) {
    try {
      localStorage.setItem(buildKey(key), JSON.stringify(data));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to save', e);
    }
  },
  load(key: string): FlowSerializable | null {
    try {
      const raw = localStorage.getItem(buildKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as any;
      // 後方互換: 旧フィールド (deviceClassMode / speedMode) は無視
      delete parsed.deviceClassMode;
      delete parsed.speedMode;
      return parsed as FlowSerializable;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load', e);
      return null;
    }
  }
};
