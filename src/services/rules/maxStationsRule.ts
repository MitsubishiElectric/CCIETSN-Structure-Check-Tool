// SPDX-License-Identifier: Apache-2.0
import { Node } from 'reactflow';
import { FlowNodeData } from '../../types/flow';
import { ValidationResult } from '../../types/validation';

/**
 * 多軸機器の補足説明を生成（機器名でユニーク化）
 */
function buildMultiAxisNote(nodes: Node<FlowNodeData>[]): string {
  const multiAxisDevices = nodes.filter(n => (n.data?.axisCount ?? 1) > 1);
  
  if (multiAxisDevices.length === 0) return '';
  
  // 機器名とaxisCountでユニーク化
  const uniqueDeviceKeys = new Set<string>();
  const uniqueDevices: Array<{ label: string; axisCount: number }> = [];
  
  for (const node of multiAxisDevices) {
    const key = `${node.data?.label}:${node.data?.axisCount}`;
    if (!uniqueDeviceKeys.has(key)) {
      uniqueDeviceKeys.add(key);
      uniqueDevices.push({
        label: node.data?.label || '',
        axisCount: node.data?.axisCount ?? 1
      });
    }
  }
  
  const notes = uniqueDevices.map(({ label, axisCount }) => 
    `${label}(${axisCount}軸)は${axisCount}台としてカウントします`
  );
  
  return '\n\n※ ' + notes.join('\n※ ');
}

/**
 * 最大接続局数チェック
 * マスタ局の maxStations に基づいて、ネットワーク全体の局数（マスタ + ローカル + リモート）をカウントし、
 * 超過している場合はエラーを返す。
 */
export function checkMaxStations(nodes: Node<FlowNodeData>[]): ValidationResult | null {
  // マスタ局を取得
  const masterNode = nodes.find(n => n.data?.stationType === 'master');
  
  // マスタ局が存在しない場合はチェックをスキップ（他のルールでチェック済み）
  if (!masterNode) {
    return null;
  }
  
  const maxStations = masterNode.data?.maxStations;
  
  // maxStations が未設定（undefined）の場合はチェックをスキップ（無制限扱い）
  if (maxStations === undefined || maxStations === null) {
    return null;
  }
  
  // 局数をカウント
  // マスタ局（1台）
  const masterCount = 1;
  
  // ローカル局をカウント（多軸ユニットは軸数分カウント）
  const localNodes = nodes.filter(n => n.data?.stationType === 'local');
  const localCount = localNodes.reduce((sum, n) => sum + (n.data?.axisCount ?? 1), 0);
  
  // リモート局をカウント（多軸ユニットは軸数分カウント）
  const remoteNodes = nodes.filter(n => n.data?.stationType === 'remote');
  const remoteCount = remoteNodes.reduce((sum, n) => sum + (n.data?.axisCount ?? 1), 0);
  
  // デバッグログ
  console.log('[maxStationsRule] Counting stations:', {
    masterCount,
    localCount,
    localNodes: localNodes.map(n => ({ label: n.data?.label, axisCount: n.data?.axisCount })),
    remoteCount,
    remoteNodes: remoteNodes.map(n => ({ label: n.data?.label, axisCount: n.data?.axisCount }))
  });
  
  // 合計局数
  const totalStations = masterCount + localCount + remoteCount;
  
  // 最大接続局数を超過しているかチェック
  if (totalStations > maxStations) {
    const masterLabel = masterNode.data?.label || 'マスタ局';
    const allStationNodes = [...localNodes, ...remoteNodes];
    const multiAxisNote = buildMultiAxisNote(allStationNodes);
    
    return {
      id: `max-stations-exceeded`,
      severity: 'error',
      status: 'DENY',
      message: `最大接続台数を超えています（${totalStations}/${maxStations}台）`,
      details: `マスタ局 [${masterLabel}] の増設ユニットも含めた最大接続可能数は${maxStations}台ですが、現在${totalStations}台（マスタ${masterCount} + ローカル${localCount} + リモート${remoteCount}）が配置されています。${multiAxisNote}`,
      nodeIds: [masterNode.id], // マスタ局のみハイライト（要望ではハイライトなしだが、将来的に使えるよう設定）
      edgeIds: []
    };
  }
  
  // 超過していない場合は null を返す
  return null;
}
