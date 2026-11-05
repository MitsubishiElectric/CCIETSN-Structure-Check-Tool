// SPDX-License-Identifier: Apache-2.0
import type { Node, Edge } from 'reactflow';
import { nanoid } from 'nanoid';
import { getPortType } from './portTypeDict';

/**
 * 自動配線の結果
 */
export interface AutoWiringResult {
  success: boolean;
  edges: Edge[];
  error?: string;
}

/**
 * 局番を持つノード（マスタ/ローカル/リモート局）を抽出してソート
 */
function extractAndSortStationNodes(nodes: Node[]): Node[] {
  return nodes
    .filter(n => {
      const data = n.data as any;
      const stationType = data?.stationType;
      const stationNumber = data?.stationNumber;
      // マスタ/ローカル/リモート局で、局番が設定されているノードのみ
      return (
        (stationType === 'master' || stationType === 'local' || stationType === 'remote') &&
        stationNumber != null
      );
    })
    .sort((a, b) => {
      const aNum = (a.data as any).stationNumber;
      const bNum = (b.data as any).stationNumber;
      return aNum - bNum;
    });
}

/**
 * 局番順にライン接続するエッジを生成
 * @param nodes - 全ノードリスト
 * @returns AutoWiringResult
 */
export function generateLineWiring(nodes: Node[]): AutoWiringResult {
  const stationNodes = extractAndSortStationNodes(nodes);

  // エラーチェック: マスタ局が存在するか
  const hasMaster = stationNodes.some(n => (n.data as any)?.stationType === 'master');
  if (!hasMaster) {
    return {
      success: false,
      edges: [],
      error: 'マスタ局が存在しません。マスタ局を追加してから自動配線を実行してください。'
    };
  }

  // エラーチェック: ノードが1つ以下
  if (stationNodes.length <= 1) {
    return {
      success: true,
      edges: [],
      error: undefined // エラーではなく、単に何もしない
    };
  }

  // エラーチェック: 局番の重複
  const stationNumbers = stationNodes.map(n => (n.data as any).stationNumber);
  const uniqueNumbers = new Set(stationNumbers);
  if (stationNumbers.length !== uniqueNumbers.size) {
    return {
      success: false,
      edges: [],
      error: '局番が重複しています。局番を修正してから自動配線を実行してください。'
    };
  }

  // エッジを生成
  const edges: Edge[] = [];
  
  // 各ノードで次に使用するポート番号を追跡
  const nodePortUsage = new Map<string, number>();
  
  for (let i = 0; i < stationNodes.length - 1; i++) {
    const currentNode = stationNodes[i];
    const nextNode = stationNodes[i + 1];
    
    // ポート種別チェック: 異なる種別の機器はスキップ
    const currentPortType = getPortType((currentNode.data as any)?.modelName) || 'ethernet';
    const nextPortType = getPortType((nextNode.data as any)?.modelName) || 'ethernet';
    
    if (currentPortType !== nextPortType) {
      // ポート種別が異なる場合は接続をスキップ
      continue;
    }
    
    const currentPortCount = (currentNode.data as any)?.portCount ?? 2;
    const nextPortCount = (nextNode.data as any)?.portCount ?? 2;
    
    // 現在のノードの次に使用するポート番号を取得（初回は1）
    const currentPortIndex = nodePortUsage.get(currentNode.id) ?? 1;
    // 次のノードの次に使用するポート番号を取得（初回は1）
    const nextPortIndex = nodePortUsage.get(nextNode.id) ?? 1;
    
    // ポート番号が範囲内かチェック
    if (currentPortIndex > currentPortCount || nextPortIndex > nextPortCount) {
      // ポートが不足している場合はスキップ
      continue;
    }
    
    // エッジを作成（無向エッジとして扱うが、React Flowでは source → target の形式）
    const edge: Edge = {
      id: nanoid(8),
      source: currentNode.id,
      target: nextNode.id,
      sourceHandle: `port${currentPortIndex}_out`,
      targetHandle: `port${nextPortIndex}_in`,
      type: 'default',
    };
    
    edges.push(edge);
    
    // 使用したポート番号を更新（次回は次のポートを使用）
    nodePortUsage.set(currentNode.id, currentPortIndex + 1);
    nodePortUsage.set(nextNode.id, nextPortIndex + 1);
  }

  return {
    success: true,
    edges,
    error: undefined
  };
}
