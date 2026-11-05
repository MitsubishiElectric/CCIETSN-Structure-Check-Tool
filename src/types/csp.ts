// SPDX-License-Identifier: Apache-2.0
/**
 * CSP (CSP+) デバイス資産インデックス関連の型定義。
 *
 * raw ZIP/BMP から前処理スクリプトで生成される `public/csp/csp-index.json` の構造を表す。
 */
import type { SpeedValue } from './flow';

/** デバイス一覧に表示する最小限サマリ */
export interface CspDeviceSummary {
  /** 一意な内部ID（ファイル名やハッシュベース。URLセーフ推奨） */
  id: string;
  /** ユーザーに表示する型名 / モデル名 */
  modelName: string;
  /** 通信IF種別 (TSNフィルタ用途) */
  commIfTypeId?: string; // e.g. 'CCLinkIETSN'
  /** 端末クラス（不明な場合は undefined） */
  class?: 'A' | 'B'; // legacy single class field
  classDefault?: 'A' | 'B'; // extracted from CommIFInformation/CertificationClass
  classOptions?: ('A' | 'B')[]; // extracted from CommIFInformation/CertificationClassChoice
  /** 局種（汎用デバイスの場合に設定） */
  stationType?: 'master' | 'local' | 'remote';
  /** 対応速度一覧（未記載なら UI 側で既定処理） */
  speedOptions?: SpeedValue[]; // CommIFInformation: ReceiveFunction/RelayFunction (1G / 100M) 両方=1 の組のみ対応と判定
  /** 代表画像への相対パス (BASE_URL 起点) 例: "csp/img/<id>.png" */
  image: string;
  /** raw ソース同一性チェック用 (sha256 など) */
  sourceHash?: string;
  /** DeviceTypeDetailの生値（csppから抽出） */
  deviceTypeDetailRaw?: string;
  /** DeviceTypeDetailの日本語分類名（正規化済み） */
  deviceTypeDetailNormalized?: string;
  /** サイクリックデータサイズ: 受信ビット（bit） */
  r_b_defaultSize?: number;
  /** サイクリックデータサイズ: 受信ワード（word, 1word=2bytes） */
  r_w_defaultSize?: number;
  /** 軸数（多軸一体サーボの場合、局数カウント時に使用） */
  axisCount?: number;
}

/** インデックス JSON 全体 */
export interface CspIndex {
  version: number;            // スキーマバージョン
  generatedAt: string;        // ISO8601
  devices: CspDeviceSummary[];
}

/** 詳細情報（必要になったら段階追加）。 */
export interface CspDeviceDetail extends CspDeviceSummary {
  description?: string;
  ports?: number;             // 推奨ポート数
  // ここに将来: firmwareVersion / vendor / capabilities 等
}

/** ランタイム検証用: インデックスらしい最小要件を満たすか */
export function isCspIndex(x: any): x is CspIndex {
  return !!x && typeof x === 'object' && typeof x.version === 'number' && Array.isArray(x.devices);
}
