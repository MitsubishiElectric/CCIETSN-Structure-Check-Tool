// SPDX-License-Identifier: Apache-2.0
import { Node, Edge } from 'reactflow';
import { FlowNodeData } from '../../types/flow';
import { ValidationResult } from '../../types/validation';
import { 
  getMasterNode, 
  getDistanceFromMaster, 
  getNodesConnectedToNode,
  isClassBAMixed 
} from './graphUtils';

/**
 * RJ71GN11-T2 マルチキャスト時のスイッチポート設定チェック
 * 
 * クラスB対応産業用スイッチ（BA混在時はクラスA対応も含む）の終端側に
 * 異なる種類の機器が混在している場合、マルチキャストフレーム転送禁止ポートの設定が必要になる。
 * 
 * 対象パターン（すべてマスタがRJ71GN11-T2の場合）:
 * 
 * [クラスBのみ、マルチキャスト、マスタ1G]
 * - 1Gと100Mのデバイス局混在 → 100M側を転送禁止
 * - デバイス局とEthernet機器混在 → Ethernet機器を転送禁止
 * 
 * [クラスBのみ、マルチキャスト、マスタ100M]
 * - デバイス局とEthernet機器混在 → Ethernet機器を転送禁止
 * 
 * [クラスBA混在、マルチキャスト、マスタ1G]
 * - 1Gと100Mのデバイス局混在 → 100M側を転送禁止
 * - ローカル局とEthernet機器混在 → Ethernet機器を転送禁止
 * - ローカル局とクラスAリモート局混在 → クラスAリモート局を転送禁止
 * 
 * [クラスBA混在、マルチキャスト、マスタ100M]
 * - ローカル局とEthernet機器混在 → Ethernet機器を転送禁止
 * - ローカル局とクラスAリモート局混在 → クラスAリモート局を転送禁止
 */
export function checkMulticastSwitchPortConstraints(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  communicationMode: 'unicast' | 'multicast'
): ValidationResult[] {
  // ステップ1: 前提条件チェック
  const masterNode = getMasterNode(nodes);
  if (!masterNode) {
    return []; // マスタ局がない場合はチェックしない
  }
  
  if (masterNode.data.label !== 'RJ71GN11-T2') {
    return []; // RJ71GN11-T2以外は対象外
  }
  
  if (communicationMode !== 'multicast') {
    return []; // マルチキャストモードのみ対象
  }
  
  // ステップ2: ネットワーク全体の状態を把握
  const isBAMixed = isClassBAMixed(nodes, edges);
  const masterSpeed = masterNode.data.speed; // '1G' or '100M' or undefined
  
  if (!masterSpeed) {
    return []; // マスタの速度が未設定の場合はチェックしない
  }
  
  // ステップ3: チェック対象のスイッチを抽出
  let targetSwitches: Node<FlowNodeData>[];
  if (isBAMixed) {
    // BA混在時: クラスBスイッチ + クラスAスイッチ
    targetSwitches = nodes.filter(n => 
      (n.data.stationType === 'switch-classB' || 
       n.data.stationType === 'switch-classA')
    );
  } else {
    // クラスBのみ: クラスBスイッチのみ
    targetSwitches = nodes.filter(n => 
      n.data.stationType === 'switch-classB'
    );
  }
  
  // ステップ4: 各スイッチについて終端側の混在をチェック
  const warnings: ValidationResult[] = [];
  for (const switchNode of targetSwitches) {
    const switchWarnings = checkSingleSwitch(
      switchNode,
      nodes,
      edges,
      masterNode,
      isBAMixed,
      masterSpeed
    );
    warnings.push(...switchWarnings);
  }
  
  return warnings;
}

/**
 * 終端側ノードの分類結果
 */
interface NodeClassification {
  devices1G: Node<FlowNodeData>[];      // 1Gデバイス局（ローカル+リモート）
  devices100M: Node<FlowNodeData>[];    // 100Mデバイス局（ローカル+リモート）
  localStations: Node<FlowNodeData>[];  // ローカル局
  remoteClassA: Node<FlowNodeData>[];   // クラスAリモート局
  remoteClassB: Node<FlowNodeData>[];   // クラスBリモート局
  ethernetDevices: Node<FlowNodeData>[]; // Ethernet機器
}

/**
 * 検出された混在パターン
 */
interface MixedPattern {
  type: string;                         // パターンの種類
  forbiddenNodes: Node<FlowNodeData>[]; // 転送禁止すべき機器
  description: string;                  // 混在内容の説明
}

/**
 * 単一スイッチについて終端側の混在をチェック
 */
function checkSingleSwitch(
  switchNode: Node<FlowNodeData>,
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  masterNode: Node<FlowNodeData>,
  isBAMixed: boolean,
  masterSpeed: string
): ValidationResult[] {
  
  // A. 隣接ノードを取得
  const neighbors = getNodesConnectedToNode(switchNode.id, nodes, edges);
  
  // B. マスタ側 vs 終端側に分類
  const switchDistance = getDistanceFromMaster(switchNode.id, masterNode.id, nodes, edges);
  const terminalSideNodes = neighbors.filter(n => {
    const dist = getDistanceFromMaster(n.id, masterNode.id, nodes, edges);
    return dist > switchDistance; // スイッチより遠い = 終端側
  });
  
  // 終端側にノードがない場合はチェック不要
  if (terminalSideNodes.length === 0) {
    return [];
  }
  
  // C. 終端側ノードを分類
  const classification = classifyTerminalNodes(terminalSideNodes);
  
  // D. パターンマッチング（複数のパターンに該当する可能性あり）
  const patterns = detectMixedPatterns(
    classification,
    isBAMixed,
    masterSpeed
  );
  
  if (patterns.length === 0) {
    return [];
  }
  
  // E. 警告生成（各パターンごと）
  const warnings: ValidationResult[] = [];
  for (const pattern of patterns) {
    const warning = generateWarning(switchNode, pattern, edges);
    if (warning) {
      warnings.push(warning);
    }
  }
  
  return warnings;
}

/**
 * 終端側ノードを種類ごとに分類
 */
function classifyTerminalNodes(nodes: Node<FlowNodeData>[]): NodeClassification {
  return {
    devices1G: nodes.filter(n => 
      (n.data.stationType === 'local' || n.data.stationType === 'remote') &&
      n.data.speed === '1G'
    ),
    devices100M: nodes.filter(n => 
      (n.data.stationType === 'local' || n.data.stationType === 'remote') &&
      n.data.speed === '100M'
    ),
    localStations: nodes.filter(n => n.data.stationType === 'local'),
    remoteClassA: nodes.filter(n => 
      n.data.stationType === 'remote' && n.data.deviceClass === 'A'
    ),
    remoteClassB: nodes.filter(n => 
      n.data.stationType === 'remote' && n.data.deviceClass === 'B'
    ),
    ethernetDevices: nodes.filter(n => n.data.stationType === 'ethernet-device')
  };
}

/**
 * 混在パターンを検出（複数のパターンに該当する可能性あり）
 */
function detectMixedPatterns(
  classification: NodeClassification,
  isBAMixed: boolean,
  masterSpeed: string
): MixedPattern[] {
  const patterns: MixedPattern[] = [];
  
  if (!isBAMixed) {
    // クラスBのみ
    if (masterSpeed === '1G') {
      // パターン1: 1G + 100M デバイス局
      if (classification.devices1G.length > 0 && classification.devices100M.length > 0) {
        patterns.push({
          type: 'speed-mixed',
          forbiddenNodes: classification.devices100M,
          description: '1Gbpsと100Mbpsのデバイス局'
        });
      }
      
      // パターン2: デバイス局 + Ethernet機器
      const hasDevices = classification.devices1G.length + classification.devices100M.length > 0;
      if (hasDevices && classification.ethernetDevices.length > 0) {
        patterns.push({
          type: 'device-ethernet-mixed',
          forbiddenNodes: classification.ethernetDevices,
          description: 'デバイス局とEthernet機器'
        });
      }
    } else { // 100M
      // パターン3: デバイス局 + Ethernet機器
      const hasDevices = classification.devices100M.length > 0;
      if (hasDevices && classification.ethernetDevices.length > 0) {
        patterns.push({
          type: 'device-ethernet-mixed',
          forbiddenNodes: classification.ethernetDevices,
          description: 'デバイス局とEthernet機器'
        });
      }
    }
  } else {
    // クラスBA混在
    if (masterSpeed === '1G') {
      // パターン4: 1G + 100M デバイス局
      if (classification.devices1G.length > 0 && classification.devices100M.length > 0) {
        patterns.push({
          type: 'speed-mixed',
          forbiddenNodes: classification.devices100M,
          description: '1Gbpsと100Mbpsのデバイス局'
        });
      }
      
      // パターン5: ローカル局 + Ethernet機器
      if (classification.localStations.length > 0 && classification.ethernetDevices.length > 0) {
        patterns.push({
          type: 'local-ethernet-mixed',
          forbiddenNodes: classification.ethernetDevices,
          description: 'ローカル局とEthernet機器'
        });
      }
      
      // パターン6: ローカル局 + クラスAリモート局
      if (classification.localStations.length > 0 && classification.remoteClassA.length > 0) {
        patterns.push({
          type: 'local-remoteA-mixed',
          forbiddenNodes: classification.remoteClassA,
          description: 'ローカル局とCC-Link IE TSN Class Aのリモート局'
        });
      }
    } else { // 100M
      // パターン7: ローカル局 + Ethernet機器
      if (classification.localStations.length > 0 && classification.ethernetDevices.length > 0) {
        patterns.push({
          type: 'local-ethernet-mixed',
          forbiddenNodes: classification.ethernetDevices,
          description: 'ローカル局とEthernet機器'
        });
      }
      
      // パターン8: ローカル局 + クラスAリモート局
      if (classification.localStations.length > 0 && classification.remoteClassA.length > 0) {
        patterns.push({
          type: 'local-remoteA-mixed',
          forbiddenNodes: classification.remoteClassA,
          description: 'ローカル局とCC-Link IE TSN Class Aのリモート局'
        });
      }
    }
  }
  
  return patterns;
}

/**
 * 警告メッセージを生成
 */
function generateWarning(
  switchNode: Node<FlowNodeData>,
  pattern: MixedPattern,
  edges: Edge[]
): ValidationResult | null {
  
  // 転送禁止すべきポート番号を取得
  const forbiddenPorts: string[] = [];
  const edgeIds: string[] = [];
  
  for (const node of pattern.forbiddenNodes) {
    const edge = edges.find(e => 
      (e.source === switchNode.id && e.target === node.id) ||
      (e.target === switchNode.id && e.source === node.id)
    );
    
    if (edge) {
      // エッジIDを記録（警告時に黄色でハイライト）
      edgeIds.push(edge.id);
      
      // スイッチ側のハンドル（ポート番号）を取得
      let portHandle: string | undefined;
      if (edge.source === switchNode.id) {
        portHandle = edge.sourceHandle || undefined;
      } else {
        portHandle = edge.targetHandle || undefined;
      }
      
      if (portHandle) {
        // ハンドル名から純粋なポート番号を抽出（例: "port2_in" → "port2"）
        const portNumber = portHandle.replace(/_in$|_out$/, '');
        forbiddenPorts.push(portNumber);
      }
    }
  }
  
  // すでに設定済みのポートを除外
  const configuredPorts = switchNode.data.forbiddenPortsConfigured || new Set<string>();
  const unconfiguredPorts = forbiddenPorts.filter(port => !configuredPorts.has(port));
  
  // すべてのポートが設定済みの場合は警告不要
  if (unconfiguredPorts.length === 0) {
    return null;
  }
  
  // ポート番号を昇順にソート（port1, port2, ... の数値部分で比較）
  const sortedPorts = unconfiguredPorts.sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });
  
  // ポート番号が取得できた場合のメッセージ
  const portMessage = sortedPorts.length > 0
    ? `${sortedPorts.join(', ')}をマルチキャスト転送禁止に設定することで通信可能となります。`
    : '該当するポートをマルチキャスト転送禁止に設定することで通信可能となります。';
  
  // スイッチのクラスを取得
  const switchClass = switchNode.data.stationType === 'switch-classA'
    ? 'CC-Link IE TSN Class A対応'
    : 'CC-Link IE TSN Class B対応';
  
  return {
    id: `multicast-switch-port-${switchNode.id}`,
    severity: 'warning',
    status: 'ALLOW',
    message: `産業用スイッチ(${switchClass})を経由した終端側に${pattern.description}が混在しています`,
    details: `産業用スイッチ(${switchClass})を経由した終端側に${pattern.description}が混在している場合、機器によっては通信できないことがあります。${portMessage}`,
    nodeIds: [switchNode.id, ...pattern.forbiddenNodes.map(n => n.id)],
    edgeIds: edgeIds
  };
}
