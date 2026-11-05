// SPDX-License-Identifier: Apache-2.0
import React, { memo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Tooltip } from '@mui/material';
import { useFlowStore } from '../../store/flowStore';
import { getPortType, type PortType } from '../../utils/portTypeDict';

interface DeviceClassNodeData {
  label: string;
  deviceClass?: 'A' | 'B';
  speed?: '100M' | '1G';
  isMaster?: boolean; // マスタ局フラグ
  stationType?: 'master' | 'local' | 'remote' | 'switch-classB' | 'switch-classA' | 'switch-general' | 'ethernet-device'; // 局の種類
  deviceTypeDetailNormalized?: string; // デバイス分類名
  modelName?: string; // モデル名（例: RJ71GN11-SX）
  imageUrl?: string;
  portCount?: number; // 1-8 (未指定は 2)
  portType?: PortType; // ポート種別 (ethernet | optical)
  opticalPortCount?: number; // 光ポート数（スイッチのみ）
  ethernetPortCount?: number; // イーサネットポート数（スイッチのみ）
  isConnecting?: boolean; // 接続操作中はクラス/速度トグルを無効化
  connectingSourceNodeId?: string | null; // 接続開始元ノードID
  deviceClassOptions?: ('A' | 'B')[]; // 選択可能なクラスの制限
  deviceSpeedOptions?: ('100M' | '1G')[]; // 選択可能な速度の制限
  stationNumber?: number; // 局番 (マスタ局: 0, ローカル/リモート: 1-253)
  onStationNumberClick?: (nodeId: string, currentNumber: number) => void; // 局番クリック時のコールバック
  onCloseValidationPanel?: () => void; // ValidationPanel閉じる用コールバック
  supportsOpticalPorts?: boolean; // 光ケーブル対応フラグ
  defaultPortType?: 'ethernet' | 'optical'; // デフォルトポート種別
  
  // パラメータ（すべてオプショナル）
  cyclicDataBytes?: number;
  supportsMulticastFilter?: boolean;
  isRingCapable?: boolean;
  firmwareVersion?: number;
  protocolVersion?: '1.0' | '2.0';
  portsUsed?: 'single' | 'both';
  hardwareVersion?: number;
  maxStations?: number;
  cycleSetting?: 'LOW' | 'BASIC' | 'MID';
  switchType?: 'ClassB' | 'ClassA' | 'General';
  forbiddenPortsConfigured?: Set<string>;
}

// ツールチップコンテンツ生成関数
const buildTooltipContent = (data: DeviceClassNodeData): string => {
  const lines: string[] = [];
  
  // 1. ノード共通パラメータ
  const roleLabels: Record<string, string> = {
    'master': 'マスタ局',
    'local': 'ローカル局',
    'remote': 'リモート局',
    'switch-classB': '産業用スイッチ（Class B対応）',
    'switch-classA': '産業用スイッチ（Class A対応）',
    'switch-general': '一般スイッチ',
    'ethernet-device': 'Ethernet機器'
  };
  lines.push(`ロール名: ${data.stationType ? roleLabels[data.stationType] : '未設定'}`);
  lines.push(`ポート数: ${data.portCount ?? '未設定'}`);
  
  // 2. 種別固有パラメータ
  if (data.stationType === 'master') {
    // マスタ局のパラメータ
    lines.push(`クラス: ${data.deviceClass ?? '未設定'}`);
    lines.push(`通信速度: ${data.speed ?? '未設定'}`);
    lines.push(`局番: ${data.stationNumber ?? '未設定'}`);
    lines.push(`マルチキャストフィルタ対応: ${data.supportsMulticastFilter != null ? (data.supportsMulticastFilter ? '対応' : '非対応') : '未設定'}`);
    lines.push(`リング対応可否: ${data.isRingCapable != null ? (data.isRingCapable ? '対応' : '非対応') : '未設定'}`);
    lines.push(`ファームウェアバージョン: ${data.firmwareVersion ?? '未設定'}`);
    lines.push(`プロトコルバージョン: ${data.protocolVersion ?? '未設定'}`);
    lines.push(`ハードウェアバージョン: ${data.hardwareVersion ?? '未設定'}`);
    lines.push(`最大接続局数: ${data.maxStations ?? '未設定'}`);
  } else if (data.stationType === 'local' || data.stationType === 'remote') {
    // ローカル/リモート局のパラメータ
    lines.push(`クラス: ${data.deviceClass ?? '未設定'}`);
    lines.push(`通信速度: ${data.speed ?? '未設定'}`);
    lines.push(`局番: ${data.stationNumber ?? '未設定'}`);
    // 周期設定を日本語に変換
    const cycleSettingLabel = data.cycleSetting ? {
      'LOW': '低速',
      'MID': '中速',
      'BASIC': '基本周期'
    }[data.cycleSetting] ?? data.cycleSetting : '未設定';
    lines.push(`周期設定: ${cycleSettingLabel}`);
    lines.push(`RX・RWr・LB・LW設定の合計バイト数: ${data.cyclicDataBytes ?? '未設定'}`);
    lines.push(`マルチキャストフィルタ対応: ${data.supportsMulticastFilter != null ? (data.supportsMulticastFilter ? '対応' : '非対応') : '未設定'}`);
    lines.push(`リング対応可否: ${data.isRingCapable != null ? (data.isRingCapable ? '対応' : '非対応') : '未設定'}`);
    lines.push(`ファームウェアバージョン: ${data.firmwareVersion ?? '未設定'}`);
    lines.push(`プロトコルバージョン: ${data.protocolVersion ?? '未設定'}`);
  } else if (data.stationType?.startsWith('switch-')) {
    // スイッチノードのパラメータ
    const switchTypeLabels: Record<string, string> = {
      'ClassB': 'Class B対応産業用スイッチ',
      'ClassA': 'Class A対応産業用スイッチ',
      'General': '一般スイッチ'
    };
    lines.push(`スイッチ種別: ${data.switchType ? switchTypeLabels[data.switchType] : '未設定'}`);
    // 禁止ポートを昇順でソート
    const sortedPorts = data.forbiddenPortsConfigured 
      ? Array.from(data.forbiddenPortsConfigured)
          .sort((a, b) => {
            const numA = parseInt(a.replace('port', ''));
            const numB = parseInt(b.replace('port', ''));
            return numA - numB;
          })
          .join(', ')
      : '未設定';
    lines.push(`マルチキャスト転送禁止設定ポート: ${sortedPorts}`);
  } else if (data.stationType === 'ethernet-device') {
    // Ethernet機器ノードのパラメータ
    lines.push(`通信速度: ${data.speed ?? '未設定'}`);
  }
  
  return lines.join('\n');
};

// カラートークン
const TOKENS = {
  A: { stripe: '#1976D2', badge: '#1976D2', softBg: '#E3F2FD' },
  B: { stripe: '#EF6C00', badge: '#EF6C00', softBg: '#FFF3E0' },
  green: { stripe: '#388E3C', badge: '#388E3C', softBg: '#E8F5E9' } // 一般スイッチ/Ethernet機器用
};

const STRIPE_W = 6;

// クリックトグル安定後: デバッグログ削除 + 再メモ化
const DeviceClassNodeImpl = ({ id, data, selected }: NodeProps<DeviceClassNodeData>) => {
  // クラス判定: スイッチの場合はstationTypeから、それ以外はdeviceClassから
  let cls: 'A' | 'B';
  if (data.stationType === 'switch-classB') {
    cls = 'B';
  } else if (data.stationType === 'switch-classA') {
    cls = 'A';
  } else {
    cls = data.deviceClass === 'B' ? 'B' : 'A';
  }
  
  // 速度判定: デフォルトは1G
  const speed = data.speed === '100M' ? '100M' : '1G';
  const isMaster = !!data.isMaster; // マスタ局判定
  const stationType = data.stationType; // 局の種類
  const stationNumber = data.stationNumber; // 局番
  
  // 一般スイッチ/Ethernet機器は緑色、それ以外はクラス色
  const useGreenColor = stationType === 'switch-general' || stationType === 'ethernet-device';
  const t = useGreenColor ? TOKENS.green : TOKENS[cls];
  const connecting = !!data.isConnecting;
  const connectingSourceNodeId = data.connectingSourceNodeId || null;
  const disableOtherSources = connecting && !!connectingSourceNodeId && connectingSourceNodeId !== id;

  // クラスバッジの表示制御
  // - TSN機器(master/local/remote): 表示、classOptionsが2つ以上なら変更可能
  // - 産業用スイッチ(switch-classB/switch-classA): 表示、変更不可
  // - 一般スイッチ/Ethernet機器(switch-general/ethernet-device): 非表示
  const showClassBadge = stationType !== 'switch-general' && stationType !== 'ethernet-device';
  const classOptions = data.deviceClassOptions;
  const canToggleClass = showClassBadge && classOptions && classOptions.length > 1; // TSN機器で2つ以上ある場合のみ変更可能
  
  // 速度バッジの表示制御
  // - TSN機器(master/local/remote): 表示、常に変更可能
  // - Ethernet機器(ethernet-device): 表示、常に変更可能
  // - スイッチ系(switch-*): 非表示
  const showSpeedBadge = stationType === 'master' || stationType === 'local' || stationType === 'remote' || stationType === 'ethernet-device';

  const portCount = Math.min(8, Math.max(1, (data as any).portCount ?? 2));
  const rightPorts = portCount <= 4 ? portCount : 4;
  const leftPorts = portCount > 4 ? portCount - 4 : 0;
  
  // portCount変更時に強制的に再レンダリング
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    forceUpdate(prev => prev + 1);
  }, [portCount]);
  
  // デバッグ: マスタ局とネットワーク機器のportCountを確認
  if (stationType === 'master' || (stationType && (stationType.startsWith('switch-') || stationType === 'ethernet-device'))) {
    console.log(`[DeviceClassNode] ${stationType} ${id}: portCount=${portCount} (raw=${(data as any).portCount}), rightPorts=${rightPorts}, leftPorts=${leftPorts}`);
  }

  const NODE_HEIGHT = 72;
  const HANDLE_SIZE = 12;
  const TARGET_HIT = 20;
  const TOP_MARGIN = 14;
  const MIN_MARGIN = 6;
  const PORT_OFFSET_DOWN = 4;

  const calcMaxGapTops = (count: number): number[] => {
    if (count <= 0) return [];
    if (count === 1) return [Math.round((NODE_HEIGHT - HANDLE_SIZE) / 2)];
    const usableHeight = NODE_HEIGHT - 2 * MIN_MARGIN - HANDLE_SIZE;
    const gap = usableHeight / (count - 1);
    return Array.from({ length: count }, (_, i) => {
      const raw = MIN_MARGIN + i * gap + PORT_OFFSET_DOWN;
      const maxTop = NODE_HEIGHT - HANDLE_SIZE;
      return Math.round(Math.min(raw, maxTop));
    });
  };
  const rightTops = calcMaxGapTops(rightPorts);
  const leftTops = calcMaxGapTops(leftPorts);

  // ポート種別判定（スイッチの混在ポート対応）
  const getPortTypeForIndex = (portIndex: number): PortType => {
    const isSwitch = data.stationType?.startsWith('switch-');
    
    if (isSwitch && data.ethernetPortCount !== undefined && data.opticalPortCount !== undefined) {
      // スイッチでポート構成が設定されている場合
      // ポート1〜ethernetPortCountがイーサネット、それ以降が光
      return portIndex <= (data.ethernetPortCount ?? 0) ? 'ethernet' : 'optical';
    } else {
      // 汎用機器またはCSP機器の場合
      // 1. data.portType が設定されていればそれを使用
      // 2. なければ modelName から判定（CSP機器）
      // 3. modelName がなければ ethernet（ネットワーク機器、汎用機器など）
      return data.portType || getPortType(data.modelName) || 'ethernet';
    }
  };
  
  const renderPort = (side: 'right' | 'left', centerTop: number, logicalIndex: number, key: string) => {
    const handleBaseId = `port${logicalIndex}`;
    const position = side === 'right' ? Position.Right : Position.Left;
    const targetTop = centerTop; // sourceと同じ位置に変更
    
    // ポート個別の種別判定
    const portTypeForThisPort = getPortTypeForIndex(logicalIndex);
    const isOpticalPort = portTypeForThisPort === 'optical';
    
    // マルチキャスト転送禁止ポートかチェック
    const portKey = `port${logicalIndex}`;
    const isForbiddenPort = data.forbiddenPortsConfigured?.has(portKey) ?? false;
    
    // 光ポートの場合はグレー枠 + 黄色塗りつぶし、それ以外は現状維持
    const portStyle = isOpticalPort 
      ? { background: '#ffd900', border: '2px solid #666', width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: '50%', top: centerTop, zIndex: 2, pointerEvents: disableOtherSources ? 'none' : 'auto' } as React.CSSProperties
      : { background: t.badge, width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: '50%', top: centerTop, zIndex: 2, pointerEvents: disableOtherSources ? 'none' : 'auto' } as React.CSSProperties;
    
    return (
      <React.Fragment key={key}>
        <Handle
          id={handleBaseId + '_out'}
          type="source"
          position={position}
          style={portStyle}
        />
        <Handle
          id={handleBaseId + '_in'}
          type="target"
          position={position}
          style={{ width: TARGET_HIT, height: TARGET_HIT, top: targetTop, opacity: 0, borderRadius: '50%', zIndex: connecting ? 4 : 1, pointerEvents: connecting ? 'auto' : 'none' }}
        />
        {/* マルチキャスト転送禁止ポートに×を重ねる */}
        {isForbiddenPort && (
          <div
            style={{
              position: 'absolute',
              right: side === 'right' ? -4 : 'auto',
              left: side === 'left' ? -4 : 'auto',
              top: centerTop - HANDLE_SIZE / 2 + 0.25,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: HANDLE_SIZE + 2,
              fontWeight: 'bold',
              color: '#000000',
              pointerEvents: 'none',
              zIndex: 3
            }}
          >
            ×
          </div>
        )}
      </React.Fragment>
    );
  };

  const setNodes = useFlowStore(s => s.setNodes);
  // 今後: 依存する setNodes の参照が安定している前提でメモ化可能
  useEffect(() => {
    // 監視や副作用が必要になった場合のみここへ追加。
  }, [id]);

  const toggleClass = () => {
    if (connecting || !canToggleClass) return; // 接続中または変更不可の場合は無効
    const next = cls === 'A' ? 'B' : 'A';
    // classOptionsがある場合、次のクラスが選択可能かチェック
    if (classOptions && !classOptions.includes(next)) return;
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...(n.data as any), deviceClass: next } } : n));
    if (data.onCloseValidationPanel) data.onCloseValidationPanel();
  };
  const toggleSpeed = () => {
    if (connecting) return; // 接続中は操作無効
    const next = speed === '1G' ? '100M' : '1G';
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...(n.data as any), speed: next } } : n));
    if (data.onCloseValidationPanel) data.onCloseValidationPanel();
  };
  const onClassKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleClass(); } };
  const onSpeedKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSpeed(); } };

  const tooltipContent = buildTooltipContent(data);

  // エッジ接続中の制御
  const shouldHideTooltip = data.isConnecting ?? false;

  return (
    <Tooltip
      key={shouldHideTooltip ? 'connecting' : 'normal'} // 接続中/通常でコンポーネントを再マウント
      title={<div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{tooltipContent}</div>}
      placement="top"
      arrow
      enterDelay={500}
      disableHoverListener={shouldHideTooltip} // 接続中はホバー表示しない
      PopperProps={{
        sx: {
          '& .MuiTooltip-tooltip': {
            maxWidth: 'none'
          }
        }
      }}
    >
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        minWidth: 120,
        maxWidth: 200,
        minHeight: NODE_HEIGHT,
        borderRadius: 8,
        background: t.softBg,
        border: isMaster ? `4px solid ${t.badge}` : (selected ? `2px solid ${t.badge}` : '1px solid #999'), // マスタ局はクラスカラーの太い枠
        boxShadow: isMaster 
          ? (selected ? `0 0 0 4px ${t.badge}33, 0 4px 8px ${t.badge}33` : '0 1px 2px rgba(0,0,0,0.12)') // マスタ局は選択時のみシャドウ
          : (selected ? `0 0 0 2px ${t.badge}33, 0 2px 4px rgba(0,0,0,0.15)` : '0 1px 2px rgba(0,0,0,0.12)'),
        fontSize: 12,
        lineHeight: 1.3,
        overflow: 'visible'
      }}
      aria-label={`Device Class ${cls} node: ${data.label}${isMaster ? ' - Master Station' : ''}`}
      data-devtest-root="device-class-node"
  // root click は今後コンテキストメニュー表示等に再利用予定
    >
      {rightTops.map((top, i) => renderPort('right', top, i + 1, `right-${i}`))}
      {leftTops.map((top, i) => renderPort('left', top, rightPorts + i + 1, `left-${i}`))}
      <div style={{ width: STRIPE_W, background: t.stripe, flexShrink: 0, borderRadius: isMaster ? '4px 0 0 4px' : '8px 0 0 8px' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '6px 8px 6px 10px', gap: 8, overflow: 'hidden' }}>
        {data.imageUrl && (
          <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 6, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 1px #0001' }}>
            <img
              src={data.imageUrl}
              alt={data.label || 'device'}
              width={40}
              height={40}
              style={{ maxWidth: '40px', maxHeight: '40px', objectFit: 'contain', display: 'block' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
            />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
          {stationType === 'master' && (
            <div style={{ fontSize: 10, color: t.badge, fontWeight: 600, marginTop: 2 }}>マスタ局</div>
          )}
          {stationType === 'local' && (
            <div style={{ fontSize: 10, color: t.badge, fontWeight: 600, marginTop: 2 }}>ローカル局</div>
          )}
          {stationType === 'remote' && (
            <div style={{ fontSize: 10, color: t.badge, fontWeight: 600, marginTop: 2 }}>リモート局</div>
          )}
          {stationType === 'switch-classB' && (
            <div style={{ fontSize: 10, color: '#757575', fontWeight: 600, marginTop: 2 }}>Class B対応スイッチ</div>
          )}
          {stationType === 'switch-classA' && (
            <div style={{ fontSize: 10, color: '#757575', fontWeight: 600, marginTop: 2 }}>Class A対応スイッチ</div>
          )}
          {stationType === 'switch-general' && (
            <div style={{ fontSize: 10, color: '#757575', fontWeight: 600, marginTop: 2 }}>一般スイッチ</div>
          )}
          {stationType === 'ethernet-device' && (
            <div style={{ fontSize: 10, color: '#757575', fontWeight: 600, marginTop: 2 }}>Ethernet機器</div>
          )}
        </div>
      </div>
  {/* 局番バッジ: マスタ/ローカル/リモート局のみ表示 */}
  {stationNumber != null && (stationType === 'master' || stationType === 'local' || stationType === 'remote') && (
    <div
      role="button"
      tabIndex={stationType !== 'master' ? 0 : -1}
      aria-label={`Station Number: ${stationNumber}${stationType === 'master' ? ' (Master - Fixed)' : ''}`}
      aria-disabled={stationType === 'master'}
      onClick={(e) => {
        e.stopPropagation();
        if (stationType !== 'master' && data.onStationNumberClick) {
          data.onStationNumberClick(id, stationNumber);
        }
      }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onMouseUp={(e) => { e.stopPropagation(); }}
      onKeyDown={(e) => {
        if (stationType !== 'master' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          if (data.onStationNumberClick) {
            data.onStationNumberClick(id, stationNumber);
          }
        }
      }}
      style={{
        position: 'absolute', top: 4, left: 12,
        background: '#757575', color: '#fff', padding: '2px 6px', fontSize: 10,
        fontWeight: 600, lineHeight: 1, borderRadius: 10, letterSpacing: 0.5,
        boxShadow: '0 0 0 1px #fff', userSelect: 'none', zIndex: 1000,
        cursor: stationType === 'master' ? 'not-allowed' : 'pointer',
        pointerEvents: 'auto',
        opacity: stationType === 'master' ? 0.7 : 1,
      }}
      data-devtest-badge="station-number"
    >No.{stationNumber}</div>
  )}
  {showClassBadge && (
    <div
          role="button"
          tabIndex={canToggleClass ? 0 : -1}
          aria-label={`Toggle Class (current: ${cls})`}
          aria-disabled={!canToggleClass}
          onClick={(e) => { e.stopPropagation(); if (canToggleClass) toggleClass(); }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onMouseUp={(e) => { e.stopPropagation(); }}
          onKeyDown={(e) => { if (canToggleClass && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleClass(); } }}
          style={{
            position: 'absolute', top: 4, right: 12,
            background: t.badge, color: '#fff', padding: '2px 6px', fontSize: 10,
            fontWeight: 600, lineHeight: 1, borderRadius: 10, letterSpacing: 0.5,
            boxShadow: '0 0 0 1px #fff', userSelect: 'none', zIndex: 1000,
            cursor: (connecting || !canToggleClass) ? 'not-allowed' : 'pointer', 
            pointerEvents: (connecting || !canToggleClass) ? 'none' : 'auto', 
            opacity: (connecting || !canToggleClass) ? 0.5 : 1
          }}
          data-devtest-badge="class"
        >{cls}</div>
  )}
  {showSpeedBadge && (
    <div
          role="button"
          tabIndex={0}
          aria-label={`Toggle Speed (current: ${speed})`}
          onClick={(e) => { e.stopPropagation(); toggleSpeed(); }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onMouseUp={(e) => { e.stopPropagation(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSpeed(); } }}
          style={{
            position: 'absolute', bottom: 4, right: 12,
            background: '#fff', color: '#000', padding: '2px 6px', fontSize: 10,
            fontWeight: 600, lineHeight: 1, borderRadius: 10, letterSpacing: 0.5,
            boxShadow: '0 0 0 1px #000', userSelect: 'none', zIndex: 1000,
            cursor: connecting ? 'not-allowed' : 'pointer', 
            pointerEvents: connecting ? 'none' : 'auto', 
            opacity: connecting ? 0.5 : 1
          }}
          data-devtest-badge="speed"
        >{speed}</div>
  )}
    </div>
    </Tooltip>
  );
};

export const DeviceClassNode = DeviceClassNodeImpl;

export default DeviceClassNode;
