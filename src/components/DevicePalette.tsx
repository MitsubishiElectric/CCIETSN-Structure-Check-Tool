// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, useMemo, useRef } from 'react';
import { loadCspIndex } from '../services/cspLoader';
import type { CspDeviceSummary } from '../types/csp';
import type { StationType } from '../types/flow';
import { TextField, Typography, CircularProgress } from '@mui/material';
import { Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

// ヘルパー関数: マスタ・ローカル対応機器かどうか判定
const canBeMasterOrLocal = (deviceTypeDetailNormalized?: string) => {
  return deviceTypeDetailNormalized === 'マスタ・ローカルユニット' 
    || deviceTypeDetailNormalized === 'ネットワークインタフェースボード'
    || deviceTypeDetailNormalized === 'マスタ局専用ユニット';
  // 汎用ローカルユニットは除外（マスタ局に昇格不可）
};

// ネットワーク機器（スイッチ・Ethernet機器）の定義
interface NetworkDevice {
  id: string;
  label: string;
  stationType: StationType;
  description?: string;
  image: string;
}

const NETWORK_DEVICES: NetworkDevice[] = [
  { id: 'switch-classB', label: '産業用スイッチ（Class B対応）', stationType: 'switch-classB', description: 'Class B対応産業用スイッチ', image: 'devices/switch-classB.png' },
  { id: 'switch-classA', label: '産業用スイッチ（Class A対応）', stationType: 'switch-classA', description: 'Class A対応産業用スイッチ', image: 'devices/switch-classA.png' },
  { id: 'switch-general', label: '一般スイッチ', stationType: 'switch-general', description: '一般的なネットワークスイッチ', image: 'devices/switch-general.png' },
  { id: 'ethernet-device', label: 'Ethernet機器', stationType: 'ethernet-device', description: 'HMI/PC/スキャナ等', image: 'devices/ethernet-device.png' }
];

// マスタ局専用機器（MXコントローラ、モーションユニット）の定義
interface MasterOnlyDevice {
  id: string;
  label: string;
  deviceTypeDetailNormalized: string;
  description?: string;
  maxStations?: number; // 最大接続局数
  image: string;
}

// MELSEC MXコントローラ
const MX_CONTROLLERS: MasterOnlyDevice[] = [
  { id: 'MXR300-16', label: 'MXR300-16', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '16軸/254局', maxStations: 254, image: 'devices/MXR300-16.bmp' },
  { id: 'MXR300-32', label: 'MXR300-32', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '32軸/254局', maxStations: 254, image: 'devices/MXR300-32.bmp' },
  { id: 'MXR300-64', label: 'MXR300-64', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '64軸/254局', maxStations: 254, image: 'devices/MXR300-64.bmp' },
  { id: 'MXR500-128', label: 'MXR500-128', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '128軸/254局', maxStations: 254, image: 'devices/MXR500-128.bmp' },
  { id: 'MXR500-256', label: 'MXR500-256', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '256軸/254局', maxStations: 254, image: 'devices/MXR500-256.bmp' },
  { id: 'MXF100-8-N32', label: 'MXF100-8-N32', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '8軸/39局', maxStations: 39, image: 'devices/MXF100-8-N32.bmp' },
  { id: 'MXF100-8-P32', label: 'MXF100-8-P32', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '8軸/39局', maxStations: 39, image: 'devices/MXF100-8-P32.bmp' },
  { id: 'MXF100-16-N32', label: 'MXF100-16-N32', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '16軸/47局', maxStations: 47, image: 'devices/MXF100-16-N32.bmp' },
  { id: 'MXF100-16-P32', label: 'MXF100-16-P32', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '16軸/47局', maxStations: 47, image: 'devices/MXF100-16-P32.bmp' },
];

// モーションユニット
const MOTION_UNITS: MasterOnlyDevice[] = [
  { id: 'RD78G4', label: 'RD78G4', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '4軸/121局', maxStations: 121, image: 'devices/RD78G4.bmp' },
  { id: 'RD78G8', label: 'RD78G8', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '8軸/121局', maxStations: 121, image: 'devices/RD78G8.bmp' },
  { id: 'RD78G16', label: 'RD78G16', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '16軸/121局', maxStations: 121, image: 'devices/RD78G16.bmp' },
  { id: 'RD78G32', label: 'RD78G32', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '32軸/121局', maxStations: 121, image: 'devices/RD78G32.bmp' },
  { id: 'RD78G64', label: 'RD78G64', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '64軸/121局', maxStations: 121, image: 'devices/RD78G64.bmp' },
  { id: 'RD78GHV', label: 'RD78GHV', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '128軸/121局', maxStations: 121, image: 'devices/RD78GHV.bmp' },
  { id: 'RD78GHW', label: 'RD78GHW', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '256軸/121局', maxStations: 121, image: 'devices/RD78GHW.bmp' },
  { id: 'FX5-40SSC-G', label: 'FX5-40SSC-G', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '4軸/21局', maxStations: 21, image: 'devices/FX5-40SSC-G.bmp' },
  { id: 'FX5-80SSC-G', label: 'FX5-80SSC-G', deviceTypeDetailNormalized: 'マスタ局専用ユニット', description: '8軸/25局', maxStations: 25, image: 'devices/FX5-80SSC-G.bmp' },
];

// 汎用機器の定義
export interface GenericDevice {
  id: string;
  label: string;
  stationType: 'master' | 'local' | 'remote';
  description?: string;
  deviceClass?: 'A' | 'B';
  deviceTypeDetailNormalized?: string;
  speed: '100M' | '1G';
  ports: number;
  image: string;
}

const GENERIC_DEVICES: GenericDevice[] = [
  { id: 'generic-master', label: '汎用マスタ局', stationType: 'master', description: 'TSNマスタ局', speed: '1G', ports: 2, image: 'devices/generic-master.bmp' },
  { id: 'generic-local', label: '汎用ローカル局', stationType: 'local', description: 'TSNローカル局', deviceClass: 'B', speed: '1G', ports: 2, image: 'devices/generic-local.bmp' },
  { id: 'generic-remote', label: '汎用リモート局', stationType: 'remote', description: 'TSNリモート局', deviceClass: 'B', speed: '1G', ports: 2, image: 'devices/generic-remote.bmp' },
];

/**
 * 右側の常時表示デバイスパレット。
 * - CSPインデックスを読み込み一覧表示
 * - アイテムをドラッグすると application/x-csp-device に JSON を積む
 * - キーワード検索フィルタ対応
 */
interface DevicePaletteProps {
  onPick?: (device: CspDeviceSummary) => void; // クリックで選択ノードへ適用（現在未使用）
  onBulkAdd?: (device: CspDeviceSummary | NetworkDevice | MasterOnlyDevice | GenericDevice, count: number) => void; // 一括追加
  onHoverChange?: (hover: boolean) => void; // ホバー領域検出 (キャンバス側の wheel 制御用)
  hasMasterSelected?: boolean; // マスタ局が選択されているか
  onAccordionChange?: () => void; // アコーディオン展開/縮小時のコールバック
}

export default function DevicePalette({ onPick, onBulkAdd, onHoverChange, hasMasterSelected, onAccordionChange }: DevicePaletteProps) {
  const [devices, setDevices] = useState<CspDeviceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [bulkCounts, setBulkCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true); setError(null);
    loadCspIndex()
      .then(idx => setDevices(idx.devices))
      .catch(e => setError(e?.message || 'failed to load csp index'))
      .finally(() => setLoading(false));
  }, []);

  // 検索フィルタ: CSPデバイス、ネットワーク機器、マスタ専用機器、汎用機器すべてに対応
  const filteredDevices = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return devices;
    return devices.filter(d => d.modelName.toLowerCase().includes(kw) || d.id.toLowerCase().includes(kw));
  }, [devices, keyword]);

  const filteredNetwork = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return NETWORK_DEVICES;
    return NETWORK_DEVICES.filter(d => 
      d.label.toLowerCase().includes(kw) || 
      d.id.toLowerCase().includes(kw) ||
      (d.description?.toLowerCase().includes(kw))
    );
  }, [keyword]);

  const filteredMX = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return MX_CONTROLLERS;
    return MX_CONTROLLERS.filter(d => 
      d.label.toLowerCase().includes(kw) || 
      d.id.toLowerCase().includes(kw) ||
      (d.description?.toLowerCase().includes(kw))
    );
  }, [keyword]);

  const filteredMotion = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return MOTION_UNITS;
    return MOTION_UNITS.filter(d => 
      d.label.toLowerCase().includes(kw) || 
      d.id.toLowerCase().includes(kw) ||
      (d.description?.toLowerCase().includes(kw))
    );
  }, [keyword]);

  const filteredGeneric = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return GENERIC_DEVICES;
    return GENERIC_DEVICES.filter(d => 
      d.label.toLowerCase().includes(kw) || 
      d.id.toLowerCase().includes(kw) ||
      (d.description?.toLowerCase().includes(kw))
    );
  }, [keyword]);

  // 分類名ごとにグループ化
  const grouped = useMemo(() => {
    const map = new Map<string, CspDeviceSummary[]>();
    for (const dev of filteredDevices) {
      const cat = dev.deviceTypeDetailNormalized || 'その他';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(dev);
    }
    // 指定順序で並べ替え
    const order = [
      'マスタ・ローカルユニット',
      'モーションユニット',
      'GOT2000シリーズ',
      '汎用ACサーボ',
      '汎用インバータ',
      'DC入力',
      'トランジスタ出力',
      '入出力混合',
      'アナログ入力',
      'アナログ出力',
      'ブリッジユニット',
      'FPGAユニット',
      'ネットワークインタフェースボード',
      'エネルギー計測ユニット',
      'リニアトラック制御ユニット'
    ];
    const entries = Array.from(map.entries());
    return entries.sort((a, b) => {
      const idxA = order.indexOf(a[0]);
      const idxB = order.indexOf(b[0]);
      // 両方リストにある場合は順序通り
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      // 片方だけリストにある場合はリストにある方を優先
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      // 両方リストにない場合は名前順
      return a[0].localeCompare(b[0], 'ja');
    });
  }, [filteredDevices]);

  const baseUrl = (import.meta as any).env?.BASE_URL ?? './';

  // 2025-11-10 再調整: パレット内ホイールがキャンバスへ届きズームするケースが残存したため capture 段階での stopPropagation を追加。
  // ポイント: preventDefault は使わずネイティブスクロールは維持、ReactFlow へのバブル/キャプチャ到達のみ確実に遮断。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheelCapture = (ev: WheelEvent) => {
      // ReactFlow へ届かせない（ズーム/パン抑止）
      ev.stopPropagation();
      // Safari 等一部ブラウザで stopImmediatePropagation が必要になるケース
      if (typeof (ev as any).stopImmediatePropagation === 'function') {
        (ev as any).stopImmediatePropagation();
      }
      // デフォルト動作 (スクロール) は維持するため preventDefault は行わない
    };
    el.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', onWheelCapture, { capture: true } as any);
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        width: 260,
        display: 'flex',
        flexDirection: 'column',
        height: '100%', // 親(右ペイン)と同高に固定し、内部 list のみスクロール
        borderLeft: '1px solid #ddd',
        background: '#fafafa',
        fontSize: 12,
        overscrollBehavior: 'contain',
        // タッチ/トラックパッドでの親パン抑止 (Y のみ自己処理)
        touchAction: 'pan-y'
      }}
      onWheel={(e) => { e.stopPropagation(); }}
      onScroll={(e) => {
        // スクロールが末端で親へ抜けて慣性パンを誘発するケースを抑止
        e.stopPropagation();
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid #ddd' }}>
        <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>機器リスト</Typography>
        <TextField
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="検索 (型名/ID)"
          size="small"
          fullWidth
          sx={{ mt: 1 }}
        />
      </div>
      <div
        ref={listRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 8 }}
        onWheel={(e) => { e.stopPropagation(); }}
        onScroll={(e) => { e.stopPropagation(); }}
      >
        {/* ネットワーク機器セクション */}
        {filteredNetwork.length > 0 && (
          <Accordion onChange={() => onAccordionChange?.()} sx={{ mb: 1, boxShadow: 'none', border: '1px solid #ddd', background: '#f9f9f9' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, background: '#e8f4f8', px: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600, color: '#1976d2' }}>ネットワーク機器</Typography>
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>({filteredNetwork.length})</span>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0.5 }}>
              {filteredNetwork.map(netDev => (
              <div key={netDev.id} style={{ marginBottom: 6 }}>
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-network-device', JSON.stringify(netDev));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={(e) => {
                    // クリック機能は無効化（ドラッグ&ドロップまたは追加ボタンのみ使用）
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: 8,
                    background: '#fff', borderRadius: 6,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.12)', cursor: 'grab',
                    border: '1px solid #e0e0e0'
                  }}
                  title={netDev.description || netDev.label}
                >
                  <div style={{ 
                    width: 46, height: 46, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    background: '#fff', borderRadius: 4,
                    boxShadow: '0 0 0 1px #00000011'
                  }}>
                    <img
                      src={baseUrl + netDev.image}
                      alt={netDev.label}
                      width={40}
                      height={40}
                      style={{ objectFit: 'contain', maxWidth: '40px', maxHeight: '40px' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{netDev.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.65 }}>{netDev.description}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={bulkCounts[netDev.id] || 1}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val > 0) {
                            setBulkCounts(prev => ({ ...prev, [netDev.id]: val }));
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 50, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3 }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const count = bulkCounts[netDev.id] || 1;
                          onBulkAdd?.(netDev, count);
                        }}
                        style={{ padding: '2px 8px', fontSize: 11, background: '#1976d2', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                      >
                        追加
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </AccordionDetails>
        </Accordion>
        )}

        {/* マスタ・ローカルユニットセクション */}
        {!loading && !error && grouped.filter(([category]) => category === 'マスタ・ローカルユニット').map(([category, devs]) => (
          <Accordion key={category} onChange={() => onAccordionChange?.()} sx={{ mb: 1, boxShadow: 'none', border: '1px solid #ddd', background: '#f9f9f9' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, background: '#f5f5f5', px: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>{category}</Typography>
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>({devs.length})</span>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0.5 }}>
              {devs.map(dev => {
                let speedHint: string | undefined;
                if (dev.speedOptions?.length === 1) speedHint = dev.speedOptions[0];
                else if (dev.speedOptions?.length === 2) speedHint = '1G/100M';
                
                // マスタ局選択中かつこの機器がマスタ対応でない場合は無効化
                const isDisabled = hasMasterSelected && !canBeMasterOrLocal(dev.deviceTypeDetailNormalized);
                
                return (
                  <div key={dev.id} style={{ marginBottom: 6 }}>
                    <div
                      draggable={!isDisabled}
                      onDragStart={(e) => {
                        if (isDisabled) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData('application/x-csp-device', JSON.stringify(dev));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={(e) => {
                        if (isDisabled) return; // マスタ選択中は無効化
                        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
                          onPick?.(dev);
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: 6,
                        background: '#fff', borderRadius: 6,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.12)', 
                        cursor: isDisabled ? 'not-allowed' : 'grab',
                        opacity: isDisabled ? 0.5 : 1,
                        pointerEvents: isDisabled ? 'none' : 'auto'
                      }}
                      title={isDisabled ? 'マスタ局選択中はマスタ対応機器のみ選択可能です' : dev.modelName}
                    >
                      <div style={{ width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 4, boxShadow: '0 0 0 1px #00000011' }}>
                        <img
                          src={baseUrl + dev.image}
                          alt={dev.modelName}
                          width={40}
                          height={40}
                          style={{ objectFit: 'contain', maxWidth: '40px', maxHeight: '40px' }}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.modelName}</div>
                        <div style={{ fontSize: 10, opacity: 0.65 }}>{dev.deviceTypeDetailNormalized || '-'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            placeholder="1"
                            value={bulkCounts[dev.id] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 1 : Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                              setBulkCounts(prev => ({ ...prev, [dev.id]: val }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 50, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3 }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onBulkAdd?.(dev, bulkCounts[dev.id] || 1);
                            }}
                            style={{ padding: '2px 8px', fontSize: 11, background: '#1976d2', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                          >
                            追加
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </AccordionDetails>
          </Accordion>
        ))}

        {/* MELSEC MXコントローラセクション */}
        {filteredMX.length > 0 && (
          <Accordion onChange={() => onAccordionChange?.()} sx={{ mb: 1, boxShadow: 'none', border: '1px solid #ddd', background: '#f9f9f9' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, background: '#f5f5f5', px: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>MXコントローラ</Typography>
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>({filteredMX.length})</span>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0.5 }}>
              {filteredMX.map(dev => (
              <div key={dev.id} style={{ marginBottom: 6 }}>
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-master-only-device', JSON.stringify(dev));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={(e) => {
                    // クリック機能は無効化（ドラッグ&ドロップまたは追加ボタンのみ使用）
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: 8,
                    background: '#fff', borderRadius: 6,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.12)', cursor: 'grab',
                    border: '1px solid #e0e0e0'
                  }}
                  title={dev.description || dev.label}
                >
                  <div style={{ 
                    width: 46, height: 46, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    background: '#fff', borderRadius: 4,
                    boxShadow: '0 0 0 1px #00000011'
                  }}>
                    <img
                      src={baseUrl + dev.image}
                      alt={dev.label}
                      width={40}
                      height={40}
                      style={{ objectFit: 'contain', maxWidth: '40px', maxHeight: '40px' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.65 }}>MXコントローラ</div>
                    <div style={{ fontSize: 10, opacity: 0.5 }}>{dev.description?.split('/')[0] || ''}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <input
                        type="number"
                        min="1"
                        max="1"
                        value="1"
                        disabled
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 50, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, background: '#f5f5f5' }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onBulkAdd?.(dev, 1);
                        }}
                        style={{ padding: '2px 8px', fontSize: 11, background: '#1976d2', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                      >
                        追加
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </AccordionDetails>
        </Accordion>
        )}

        {/* モーションユニットセクション */}
        {filteredMotion.length > 0 && (
          <Accordion onChange={() => onAccordionChange?.()} sx={{ mb: 1, boxShadow: 'none', border: '1px solid #ddd', background: '#f9f9f9' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, background: '#f5f5f5', px: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>モーションユニット</Typography>
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>({filteredMotion.length})</span>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0.5 }}>
              {filteredMotion.map(dev => (
              <div key={dev.id} style={{ marginBottom: 6 }}>
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-master-only-device', JSON.stringify(dev));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={(e) => {
                    // クリック機能は無効化（ドラッグ&ドロップまたは追加ボタンのみ使用）
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: 8,
                    background: '#fff', borderRadius: 6,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.12)', cursor: 'grab',
                    border: '1px solid #e0e0e0'
                  }}
                  title={dev.description || dev.label}
                >
                  <div style={{ 
                    width: 46, height: 46, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    background: '#fff', borderRadius: 4,
                    boxShadow: '0 0 0 1px #00000011'
                  }}>
                    <img
                      src={baseUrl + dev.image}
                      alt={dev.label}
                      width={40}
                      height={40}
                      style={{ objectFit: 'contain', maxWidth: '40px', maxHeight: '40px' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.65 }}>モーションユニット</div>
                    <div style={{ fontSize: 10, opacity: 0.5 }}>{dev.description?.split('/')[0] || ''}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <input
                        type="number"
                        min="1"
                        max="1"
                        value="1"
                        disabled
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 50, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, background: '#f5f5f5' }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onBulkAdd?.(dev, 1);
                        }}
                        style={{ padding: '2px 8px', fontSize: 11, background: '#1976d2', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                      >
                        追加
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </AccordionDetails>
        </Accordion>
        )}

        {/* その他のCSPデバイスセクション */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8 }}>
            <CircularProgress size={16} />
            <span>読み込み中...</span>
          </div>
        )}
        {error && (
          <Typography color="error" sx={{ px: 1, py: 0.5 }}>{error}</Typography>
        )}
        {!loading && !error && grouped.length === 0 && (
          <Typography sx={{ px: 1, py: 0.5, opacity: 0.7 }}>該当なし</Typography>
        )}
        {!loading && !error && grouped.filter(([category]) => category !== 'マスタ・ローカルユニット').map(([category, devs]) => (
          <Accordion key={category} onChange={() => onAccordionChange?.()} sx={{ mb: 1, boxShadow: 'none', border: '1px solid #eee' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, background: '#f5f5f5', px: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>{category}</Typography>
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>({devs.length})</span>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0.5 }}>
              {devs.map(dev => {
                let speedHint: string | undefined;
                if (dev.speedOptions?.length === 1) speedHint = dev.speedOptions[0];
                else if (dev.speedOptions?.length === 2) speedHint = '1G/100M';
                return (
                  <div key={dev.id} style={{ marginBottom: 6 }}>
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-csp-device', JSON.stringify(dev));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={(e) => {
                        // 数量入力やボタン以外をクリックした場合のみ適用
                        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
                          onPick?.(dev);
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: 6,
                        background: '#fff', borderRadius: 6,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.12)', cursor: 'grab'
                      }}
                      title={dev.modelName}
                    >
                      <div style={{ width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 4, boxShadow: '0 0 0 1px #00000011' }}>
                        <img
                          src={baseUrl + dev.image}
                          alt={dev.modelName}
                          width={40}
                          height={40}
                          style={{ objectFit: 'contain', maxWidth: '40px', maxHeight: '40px' }}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.modelName}</div>
                        <div style={{ fontSize: 10, opacity: 0.65 }}>{dev.deviceTypeDetailNormalized || '-'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            placeholder="1"
                            value={bulkCounts[dev.id] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 1 : Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                              setBulkCounts(prev => ({ ...prev, [dev.id]: val }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 50, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3 }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onBulkAdd?.(dev, bulkCounts[dev.id] || 1);
                            }}
                            style={{ padding: '2px 8px', fontSize: 11, background: '#1976d2', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                          >
                            追加
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </AccordionDetails>
          </Accordion>
        ))}

        {/* 汎用機器セクション */}
        {filteredGeneric.length > 0 && (
          <Accordion onChange={() => onAccordionChange?.()} sx={{ mb: 1, boxShadow: 'none', border: '1px solid #ddd', background: '#f9f9f9' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, background: '#e3f2fd', px: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600, color: '#1565c0' }}>汎用機器</Typography>
              <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>({filteredGeneric.length})</span>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0.5 }}>
              {filteredGeneric.map(genDev => (
                <div key={genDev.id} style={{ marginBottom: 6 }}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-generic-device', JSON.stringify(genDev));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={(e) => {
                      // クリック機能は無効化（ドラッグ&ドロップまたは追加ボタンのみ使用）
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: 6,
                      background: '#fff', borderRadius: 6,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.12)', cursor: 'grab'
                    }}
                    title={genDev.label}
                  >
                    <div style={{ width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 4, boxShadow: '0 0 0 1px #00000011' }}>
                      <img
                        src={baseUrl + genDev.image}
                        alt={genDev.label}
                        width={40}
                        height={40}
                        style={{ objectFit: 'contain', maxWidth: '40px', maxHeight: '40px' }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{genDev.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.65 }}>{genDev.description}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <input
                          type="number"
                          min="1"
                          max={genDev.stationType === 'master' ? "1" : "100"}
                          placeholder="1"
                          value={genDev.stationType === 'master' ? "1" : (bulkCounts[genDev.id] ?? '')}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 1 : Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                            setBulkCounts(prev => ({ ...prev, [genDev.id]: val }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={genDev.stationType === 'master'}
                          style={{ width: 50, padding: '2px 4px', fontSize: 11, border: '1px solid #ccc', borderRadius: 3 }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onBulkAdd?.(genDev, bulkCounts[genDev.id] || 1);
                          }}
                          style={{ padding: '2px 8px', fontSize: 11, background: '#1976d2', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                        >
                          追加
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </AccordionDetails>
          </Accordion>
        )}
      </div>
      <div style={{ padding: '4px 8px', borderTop: '1px solid #ddd', fontSize: 10, opacity: 0.6 }}>
        クリック: 選択ノードへ適用 / Drag: 追加
      </div>
    </div>
  );
}
