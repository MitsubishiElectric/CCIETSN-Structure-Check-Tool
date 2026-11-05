// SPDX-License-Identifier: Apache-2.0
import { nanoid } from 'nanoid';
import { Edge, Node, XYPosition } from 'reactflow';
import { create } from 'zustand';

import { storage } from '../services/storage';
import { CommunicationMode, FlowSerializable, HistoryState, SpeedValue } from '../types/flow';
import { getMaxStations } from '../utils/maxStationsDict';
import { getDefaultPortCount, getOpticalPortInfo } from '../utils/portCountDict';
import { getPortType } from '../utils/portTypeDict';
import { 
  getDefaultClass, 
  canChangeClass, 
  getDeviceClass,
  getDefaultFirmwareVersion,
  getDefaultProtocolVersion,
  getDefaultHardwareVersion,
  getDefaultMulticastFilter,
  getDefaultRingCapable,
  getDefaultCycleSetting,
  getDefaultCyclicDataBytes
} from '../utils/deviceDefaults';

import type { CspDeviceSummary } from '../types/csp';

interface FlowStore {
  nodes: Node[];
  edges: Edge[];
  communicationMode: CommunicationMode; // 通信モード
  history: HistoryState[];
  future: HistoryState[];
  addNode: (position?: XYPosition, device?: CspDeviceSummary) => string;
  setNodes: (updater: (nodes: Node[]) => Node[]) => void;
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void;
  setCommunicationMode: (mode: CommunicationMode) => void; // 通信モード設定
  setNodeDeviceClass: (nodeId: string, cls: 'A' | 'B') => void;
  setNodeSpeed: (nodeId: string, speed: SpeedValue) => void;
  startNodeDrag: () => void;
  finalizeNodeDrag: () => void;
  undo: () => void;
  redo: () => void;
  toSerializable: () => FlowSerializable;
  loadFromSerializable: (data: FlowSerializable) => void;
}

// 初期ノードは廃止: キャンバスは空で開始し、最初に追加された「マスタ・ローカルユニット」分類の TSN 対応機器を自動的にマスタ局に昇格する。

// -------- Helpers --------
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/**
 * 履歴保存用: ノードのSetを配列に変換してクローン
 */
function cloneNodesForHistory(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  return nodes.map(node => {
    const cloned = JSON.parse(JSON.stringify(node));
    // forbiddenPortsConfiguredがSetの場合は配列に変換
    if (node.data?.forbiddenPortsConfigured instanceof Set) {
      cloned.data.forbiddenPortsConfigured = Array.from(node.data.forbiddenPortsConfigured);
    }
    return cloned;
  });
}

/**
 * 履歴復元用: ノードの配列をSetに戻す
 */
function restoreNodesFromHistory(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  return nodes.map(node => {
    const restored = { ...node };
    // forbiddenPortsConfiguredが配列の場合はSetに変換
    if (Array.isArray(node.data?.forbiddenPortsConfigured)) {
      restored.data = {
        ...node.data,
        forbiddenPortsConfigured: new Set(node.data.forbiddenPortsConfigured)
      };
    }
    return restored;
  });
}

// 次に割り当てる局番を取得
// マスタ局は常に0、ローカル/リモート局は1-253の未使用番号を返す
function getNextStationNumber(nodes: Node[], stationType: string): number {
  // マスタ局は常に0
  if (stationType === 'master') return 0;
  
  // Ethernet機器とスイッチには局番を割り当てない
  if (stationType === 'ethernet-device' || stationType.startsWith('switch-')) {
    return -1; // 局番なし
  }
  
  // ローカル/リモート局: 既存の局番を収集(0を除外)
  const usedNumbers = nodes
    .map(n => (n.data as any)?.stationNumber)
    .filter((num): num is number => num != null && num > 0);
  
  // 1～253の中で未使用の最小値を返す
  for (let i = 1; i <= 253; i++) {
    if (!usedNumbers.includes(i)) return i;
  }
  
  // すべて使用済みの場合は1を返す(異常系)
  return 1;
}

// ノード配列の意味的変化を判定（位置だけや selected だけの変更は履歴対象外にする）
function isMeaningfulNodeChange(prev: Node[], next: Node[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id) return true;
    const ad = a.data as any;
    const bd = b.data as any;
    // ラベル / deviceClass / speed / isMaster / stationType の意味的変更を履歴対象
    if (ad?.label !== bd?.label) return true;
    if (ad?.deviceClass !== bd?.deviceClass) return true;
    if (ad?.speed !== bd?.speed) return true;
    if (ad?.isMaster !== bd?.isMaster) return true;
    if (ad?.stationType !== bd?.stationType) return true;
    // 位置差分だけなら履歴化しない
  }
  return false;
}

// エッジ配列の意味的変化判定（接続増減 or ラベル変更のみを履歴化）
function isMeaningfulEdgeChange(prev: Edge[], next: Edge[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id || a.source !== b.source || a.target !== b.target) return true;
    if ((a as any).label !== (b as any).label) return true;
  }
  return false;
}

export const useFlowStore = create<FlowStore>((set, get) => {
  // ノード位置ドラッグのベースライン（state外：履歴に影響しない内部変数）
  let dragBaseline: HistoryState | null = null;

  return {
  nodes: [],
    edges: [],
  communicationMode: 'unicast', // デフォルトはユニキャスト
  // 初期状態からグローバルは常に MIXED 運用（ユーザーはノード単位で右クリックから設定）
  // グローバルモード撤廃: 常にノード個別設定
    history: [], // 現在状態は含まず「過去」のみ
    future: [],
    addNode: (position?: XYPosition, device?: CspDeviceSummary) => {
      const { nodes, edges, history } = get();
      const snapshot: HistoryState = {
        nodes: cloneNodesForHistory(nodes),
        edges: JSON.parse(JSON.stringify(edges))
      };
      set({
        history: [...history, snapshot].slice(-50),
        future: []
      });
      const id = nanoid(6);
      // 追加ノードの初期値 (デバイスが指定されていない場合のフォールバック)
      let initialDeviceClass: 'A' | 'B' | undefined = 'A';
      let initialSpeed: SpeedValue | undefined = '1G';
      let deviceClassOptions: ('A' | 'B')[] | undefined;
      let deviceSpeedOptions: SpeedValue[] | undefined;
      let label = `Node ${nodes.length}`;
      let imageUrl: string | undefined;
      let stationType: 'master' | 'local' | 'remote' | 'switch-classB' | 'switch-classA' | 'switch-general' | 'ethernet-device' = 'remote';
      let deviceTypeDetailNormalized: string | undefined;
      let isMaster = false;
      
      if (device) {
        label = device.modelName;
        deviceTypeDetailNormalized = device.deviceTypeDetailNormalized;
        
        // 汎用デバイスの場合は device.stationType を使用
        if (device.stationType) {
          stationType = device.stationType;
        }
        
        // ネットワーク機器の判定（deviceTypeDetailNormalizedにstationTypeが入っている場合）
        const isNetworkDevice = deviceTypeDetailNormalized && [
          'switch-classB', 'switch-classA', 'switch-general', 'ethernet-device'
        ].includes(deviceTypeDetailNormalized);
        
        // マスタ局専用機器の判定
        const isMasterOnlyDevice = deviceTypeDetailNormalized === 'マスタ局専用ユニット';
        
        if (isNetworkDevice) {
          // ネットワーク機器の場合
          stationType = deviceTypeDetailNormalized as any;
          // 産業用スイッチの場合は対応クラスを設定、変更不可
          if (deviceTypeDetailNormalized === 'switch-classB') {
            initialDeviceClass = 'B';
          } else if (deviceTypeDetailNormalized === 'switch-classA') {
            initialDeviceClass = 'A';
          } else {
            // 一般スイッチ/Ethernet機器はクラスなし
            initialDeviceClass = undefined;
          }
          // Ethernet機器の速度初期値は1G
          if (deviceTypeDetailNormalized === 'ethernet-device') {
            initialSpeed = '1G';
          } else {
            initialSpeed = undefined; // スイッチは速度なし
          }
        } else if (isMasterOnlyDevice) {
          // マスタ局専用機器の場合
          // 既にマスタ局が存在する場合はエラーを投げる
          if (nodes.some(n => (n.data as any)?.isMaster)) {
            throw new Error('マスタ局は1台のみ配置可能です。既存のマスタ局を削除してから追加してください。');
          }
          // マスタ局専用機器は必ずマスタ局、Class B固定、速度は1G/100M対応
          stationType = 'master';
          isMaster = true;
          initialDeviceClass = 'B';
          deviceClassOptions = undefined; // Class変更不可
          initialSpeed = '1G';
          deviceSpeedOptions = ['100M', '1G']; // 速度切り替え可能
        } else {
          // TSN対応機器の場合
          // 汎用機器かどうか判定して deviceId を構成
          const isGenericDevice = label.includes('汎用');
          let deviceId: string;
          if (isGenericDevice) {
            // 汎用機器: パレットで既に stationType が設定されている場合はそれを使う、
            // されていない場合はマスタ・ローカル判定で決定
            const finalStationType = ['master', 'local', 'remote'].includes(stationType) 
              ? stationType 
              : (device.deviceTypeDetailNormalized === 'マスタ・ローカルユニット' 
                  || device.deviceTypeDetailNormalized === 'ネットワークインタフェースボード'
                  || device.deviceTypeDetailNormalized === '汎用ローカルユニット'
                  ? 'local' 
                  : 'remote');
            deviceId = `generic-${finalStationType}`;
          } else {
            // TSN対応機器: モデル名で検索
            deviceId = device?.modelName || stationType;
          }
          
          // CSV からデフォルトクラスとクラス変更可否を取得
          const defaultClass = getDefaultClass(deviceId);
          const canChange = canChangeClass(deviceId);
          initialDeviceClass = defaultClass;
          deviceClassOptions = canChange ? ['A', 'B'] : undefined;
          
          // デバッグログ
          const csvDeviceClass = getDeviceClass(deviceId);
          console.warn(`[flowStore] 汎用機器追加: label="${label}"`);
          console.warn(`  stationType="${stationType}", deviceId="${deviceId}"`);
          console.warn(`  CSV deviceClass="${csvDeviceClass}", defaultClass="${defaultClass}"`);
          console.warn(`  canChange=${canChange} (deviceClass includes comma: ${(csvDeviceClass || '').includes(',')})`);
          console.warn(`  → deviceClassOptions=${JSON.stringify(deviceClassOptions)}`);
          // 局種別の判定: マスタ・ローカルユニット、ネットワークインタフェースボード分類ならローカル局、それ以外はリモート局
          // (汎用機器の場合はパレットで既に決まっているのでここでは上書きしない)
          if (!isGenericDevice) {
            const isMasterLocalCapable = device.deviceTypeDetailNormalized === 'マスタ・ローカルユニット' 
              || device.deviceTypeDetailNormalized === 'ネットワークインタフェースボード'
              || device.deviceTypeDetailNormalized === '汎用ローカルユニット';
            stationType = isMasterLocalCapable ? 'local' : 'remote';
          } else {
            // 汎用機器: label から stationType を決定
            if (label.includes('マスタ')) {
              stationType = 'master';
            } else if (label.includes('ローカル')) {
              stationType = 'local';
            } else if (label.includes('リモート')) {
              stationType = 'remote';
            }
          }
          // 速度初期値: 両対応なら 1G、片方のみならそれ、1G 非対応なら 100M。
          if (device.speedOptions && device.speedOptions.length) {
            deviceSpeedOptions = device.speedOptions;
            if (device.speedOptions.includes('1G')) initialSpeed = '1G';
            if (!device.speedOptions.includes('1G') && device.speedOptions.includes('100M')) initialSpeed = '100M';
            if (device.speedOptions.length === 1) initialSpeed = device.speedOptions[0];
          }
        }
        
        const baseUrl = (import.meta as any).env?.BASE_URL ?? './';
        if (device.image) imageUrl = baseUrl + device.image;
      }
      // マスタ局自動設定: 既にマスタ局が存在しない かつ 以下のいずれか
      // 1. stationType === 'local' の TSN 対応機器（汎用ローカルは除外）
      // 2. stationType === 'master' の汎用機器（汎用マスタ局）
      const isGenericDevice = label && label.includes('汎用');
      const isGenericMaster = isGenericDevice && stationType === 'master';

      // 追加ボタン経路と揃え、汎用マスタ局もマスタ局専用ユニット扱い（複製メニュー非表示）にする
      if (isGenericMaster) {
        deviceTypeDetailNormalized = 'マスタ局専用ユニット';
      }
      
      if (!nodes.some(n => (n.data as any)?.isMaster)) {
        // マスタ局が存在しない場合
        if (isGenericMaster) {
          // 汎用マスタ局の場合は明示的にisMasterを設定
          isMaster = true;
          // stationTypeは既にmasterなので変更不要
        } else if (stationType === 'local' && !isGenericDevice) {
          // TSN対応のローカル局の場合は自動昇格
          isMaster = true;
          stationType = 'master';
        }
      }
      
      // マスタ局の最大接続局数を設定
      let maxStations: number | undefined;
      if (stationType === 'master' && device) {
        // 汎用マスタ局か通常のマスタ局かを判定
        const masterDeviceId = isGenericDevice ? 'generic-master' : device.modelName;
        maxStations = getMaxStations(masterDeviceId);
      }
      
      // 局番を自動採番
      const stationNumber = getNextStationNumber(nodes, stationType);
      
      // ポート数を辞書から取得
      // ネットワーク機器はstationType、汎用機器はgeneric-{stationType}、TSN機器はmodelNameで判定
      const isNetworkDevice = stationType.startsWith('switch-') || stationType === 'ethernet-device';
      
      let deviceId: string;
      if (isNetworkDevice) {
        deviceId = stationType;
      } else if (isGenericDevice) {
        deviceId = `generic-${stationType}`;
      } else {
        deviceId = device?.modelName || stationType;
      }
      
      let portCount = getDefaultPortCount(deviceId);
      
      // 光ケーブル対応情報を取得
      const opticalPortInfo = getOpticalPortInfo(deviceId);
      
      // ネットワーク機器のswitchType設定
      let switchType: 'ClassB' | 'ClassA' | 'General' | undefined;
      if (stationType && stationType.startsWith('switch-')) {
        // switchType初期値を設定
        if (stationType === 'switch-classB') {
          switchType = 'ClassB';
        } else if (stationType === 'switch-classA') {
          switchType = 'ClassA';
        } else if (stationType === 'switch-general') {
          switchType = 'General';
        }
      }

      // ============ 右クリック編集用パラメータのデフォルト値を設定 ============
      
      // 共通パラメータ
      let firmwareVersion: number | string | undefined;
      let protocolVersion: '1.0' | '2.0' | undefined;
      let supportsMulticastFilter: boolean | undefined;
      let isRingCapable: boolean | undefined;

      // マスタ局用パラメータ
      let hardwareVersion: number | string | undefined;

      // ローカル・リモート局用パラメータ
      let cycleSetting: 'LOW' | 'MID' | 'BASIC' | undefined;
      let cyclicDataBytes: number | undefined;

      if (stationType === 'master' && device) {
        // マスタ局の場合
        const masterDeviceId = isGenericDevice ? 'generic-master' : device.modelName;
        
        const fwVersion = getDefaultFirmwareVersion(masterDeviceId);
        firmwareVersion = fwVersion === '' ? undefined : fwVersion;
        
        const protVer = getDefaultProtocolVersion(masterDeviceId);
        protocolVersion = protVer as '1.0' | '2.0';
        
        const hwVersion = getDefaultHardwareVersion(masterDeviceId);
        hardwareVersion = hwVersion === '' ? undefined : hwVersion;
        
        const multicast = getDefaultMulticastFilter(masterDeviceId);
        supportsMulticastFilter = multicast;
        
        const ringCapable = getDefaultRingCapable(masterDeviceId);
        isRingCapable = ringCapable;
      } else if (stationType === 'local' || stationType === 'remote') {
        // ローカル・リモート局の場合
        const lrDeviceId = isGenericDevice ? `generic-${stationType}` : device?.modelName;
        if (lrDeviceId) {
          const fwVersion = getDefaultFirmwareVersion(lrDeviceId);
          firmwareVersion = fwVersion === '' ? undefined : fwVersion;
          
          const protVer = getDefaultProtocolVersion(lrDeviceId);
          protocolVersion = protVer as '1.0' | '2.0';
          
          cycleSetting = getDefaultCycleSetting(lrDeviceId);
          
          const cyclicBytes = getDefaultCyclicDataBytes(lrDeviceId);
          cyclicDataBytes = cyclicBytes > 0 ? cyclicBytes : undefined;
          
          const multicast = getDefaultMulticastFilter(lrDeviceId);
          supportsMulticastFilter = multicast;
          
          const ringCapable = getDefaultRingCapable(lrDeviceId);
          isRingCapable = ringCapable;
        }
      }
      
      set((state) => ({
        nodes: [
          ...state.nodes,
          {
            id,
            data: {
              label,
              modelName: device?.modelName, // 形名を保存（ポート数判定に使用）
              deviceClass: initialDeviceClass,
              speed: initialSpeed,
              imageUrl,
              deviceClassOptions,
              deviceSpeedOptions,
              stationType,
              deviceTypeDetailNormalized,
              isMaster,
              stationNumber: stationNumber >= 0 ? stationNumber : undefined, // -1の場合はundefined
              portCount,
              switchType,
              maxStations,
              portType: device?.modelName ? getPortType(device.modelName) : 'ethernet',
              supportsOpticalPorts: opticalPortInfo.supportsOpticalPorts,
              defaultPortType: opticalPortInfo.defaultPortType,
              // 右クリック編集用パラメータ
              firmwareVersion,
              protocolVersion,
              hardwareVersion,
              supportsMulticastFilter,
              isRingCapable,
              cycleSetting,
              cyclicDataBytes,
              // 軸数（多軸サーボの場合）
              ...(device?.axisCount ? { axisCount: device.axisCount } : {})
            },
            position: position ?? { x: 150 + state.nodes.length * 20, y: 80 },
            type: 'deviceClass'
          }
        ]
      }));
      storage.save('flowchart:auto', get().toSerializable());
      return id;
    },
    setNodeDeviceClass: (nodeId: string, cls: 'A' | 'B') => {
      const { nodes, edges, history } = get();
      const target = nodes.find(n => n.id === nodeId);
      if (!target) return;
      if ((target.data as any)?.deviceClass === cls) return; // 変化なし
      const snapshot: HistoryState = { nodes: cloneNodesForHistory(nodes), edges: deepClone(edges) };
      const newNodes = nodes.map(n => n.id === nodeId ? { ...n, data: { ...(n.data as any), deviceClass: cls } } : n);
      set({ nodes: newNodes, history: [...history, snapshot].slice(-50), future: [] });
      storage.save('flowchart:auto', get().toSerializable());
    },
    setNodeSpeed: (nodeId: string, speed: SpeedValue) => {
      const { nodes, edges, history } = get();
      const target = nodes.find(n => n.id === nodeId);
      if (!target) return;
      if ((target.data as any)?.speed === speed) return;
      const snapshot: HistoryState = { nodes: cloneNodesForHistory(nodes), edges: deepClone(edges) };
      const newNodes = nodes.map(n => n.id === nodeId ? { ...n, data: { ...(n.data as any), speed } } : n);
      set({ nodes: newNodes, history: [...history, snapshot].slice(-50), future: [] });
      storage.save('flowchart:auto', get().toSerializable());
    },
    setCommunicationMode: (mode: CommunicationMode) => {
      set({ communicationMode: mode });
      storage.save('flowchart:auto', get().toSerializable());
    },
    startNodeDrag: () => {
      if (dragBaseline) return; // 既に記録済み
      const { nodes, edges } = get();
      dragBaseline = { nodes: cloneNodesForHistory(nodes), edges: deepClone(edges) };
    },
    finalizeNodeDrag: () => {
      if (!dragBaseline) return;
  const { nodes, edges, history } = get();
      // 位置が一つでも変わっていれば履歴追加
      const changed = dragBaseline.nodes.some((prevNode) => {
        const cur = nodes.find((n) => n.id === prevNode.id);
        return cur && (cur.position.x !== prevNode.position.x || cur.position.y !== prevNode.position.y);
      });
      if (changed) {
        // 状態を確定して履歴に保存（Setを配列に変換）
        const cleanedBaseline: HistoryState = {
          nodes: cloneNodesForHistory(dragBaseline.nodes),
          edges: dragBaseline.edges
        };
        const nextHistory = [...history, cleanedBaseline].slice(-50);
        set({ history: nextHistory, future: [] });
        storage.save('flowchart:auto', get().toSerializable());
      }
      dragBaseline = null;
    },
    setNodes: (updater: (nodes: Node[]) => Node[]) => {
      const { nodes: prevNodes, edges, history } = get();
      const newNodes = updater(prevNodes);
      if (isMeaningfulNodeChange(prevNodes, newNodes)) {
        const snapshot: HistoryState = { nodes: cloneNodesForHistory(prevNodes), edges: deepClone(edges) };
        set({ history: [...history, snapshot].slice(-50), future: [] });
      }
      set({ nodes: newNodes });
      storage.save('flowchart:auto', get().toSerializable());
    },
    setEdges: (updater: (edges: Edge[]) => Edge[]) => {
      const { nodes, edges: prevEdges, history } = get();
      const newEdges = updater(prevEdges);
      if (isMeaningfulEdgeChange(prevEdges, newEdges)) {
        const snapshot: HistoryState = { nodes: cloneNodesForHistory(nodes), edges: deepClone(prevEdges) };
        set({ history: [...history, snapshot].slice(-50), future: [] });
      }
      set({ edges: newEdges });
      storage.save('flowchart:auto', get().toSerializable());
    },
    undo: () => {
      const { history, nodes, edges, future } = get();
      if (!history.length) return; // これ以上戻せない
      const prev = history[history.length - 1];
      const newHistory = history.slice(0, -1);
      const current: HistoryState = { nodes: cloneNodesForHistory(nodes), edges };
      const restoredNodes = restoreNodesFromHistory(prev.nodes);
      set({ nodes: restoredNodes, edges: prev.edges, history: newHistory, future: [current, ...future] });
      storage.save('flowchart:auto', get().toSerializable());
    },
    redo: () => {
      const { future, nodes, edges, history } = get();
      if (!future.length) return;
      const next = future[0];
      const rest = future.slice(1);
      const current: HistoryState = { nodes: cloneNodesForHistory(nodes), edges };
      const restoredNodes = restoreNodesFromHistory(next.nodes);
      set({ nodes: restoredNodes, edges: next.edges, history: [...history, current].slice(-50), future: rest });
      storage.save('flowchart:auto', get().toSerializable());
    },
    toSerializable: () => {
      const { nodes, edges, communicationMode } = get();
      
      // Setを配列に変換してからエクスポート（JSONシリアライズ可能にする）
      const serializedNodes = nodes.map(node => {
        const nodeData = { ...node.data };
        
        // forbiddenPortsConfigured が Set の場合、配列に変換
        if (nodeData.forbiddenPortsConfigured instanceof Set) {
          nodeData.forbiddenPortsConfigured = Array.from(nodeData.forbiddenPortsConfigured) as any;
        }
        
        return {
          ...node,
          data: nodeData
        };
      });
      
      return { 
        nodes: serializedNodes, 
        edges, 
        communicationMode,
        version: 1, 
        updatedAt: new Date().toISOString() 
      };
    },
    loadFromSerializable: (data: FlowSerializable) => {
      const { nodes, edges, history } = get();
      // 基本バリデーション
      if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return;
      const snapshot: HistoryState = { nodes: deepClone(nodes), edges: deepClone(edges) };
      
      // ノードのポート数を辞書の値で上書き（一貫性確保）
      const normNodes = data.nodes.map(n => {
        const nodeData = { ...(n as any).data };
        
        // 機器IDを取得（ネットワーク機器・汎用機器・TSN機器で判定方法が異なる）
        const stationType = nodeData.stationType;
        const label = nodeData.label || '';
        const isNetworkDevice = stationType?.startsWith('switch-') || stationType === 'ethernet-device';
        const isGenericDevice = label.includes('汎用');
        
        let deviceId: string;
        if (isNetworkDevice) {
          deviceId = stationType;
        } else if (isGenericDevice) {
          deviceId = `generic-${stationType}`;
        } else {
          deviceId = nodeData.modelName || stationType;
        }
        
        if (deviceId) {
          // 辞書から正しいポート数を取得（JSONに値がない場合のみ適用）
          if (nodeData.portCount === undefined) {
            const correctPortCount = getDefaultPortCount(deviceId);
            nodeData.portCount = correctPortCount;
          }
          
          // 全ての機器タイプ共通で読み込むパラメータ
          // JSONに値がない場合（undefined）のみデフォルト値を適用
          // ユーザーが設定した値（null含む）は保持する
          
          if (nodeData.firmwareVersion === undefined) {
            const firmwareVersion = getDefaultFirmwareVersion(deviceId);
            if (firmwareVersion !== '') nodeData.firmwareVersion = firmwareVersion;
          }
          
          if (nodeData.protocolVersion === undefined) {
            const protocolVersion = getDefaultProtocolVersion(deviceId);
            nodeData.protocolVersion = protocolVersion;
          }
          
          if (nodeData.hardwareVersion === undefined) {
            const hardwareVersion = getDefaultHardwareVersion(deviceId);
            if (hardwareVersion !== '') nodeData.hardwareVersion = hardwareVersion;
          }
          
          if (nodeData.supportsMulticastFilter === undefined) {
            const supportsMulticastFilter = getDefaultMulticastFilter(deviceId);
            nodeData.supportsMulticastFilter = supportsMulticastFilter;
          }
          
          if (nodeData.isRingCapable === undefined) {
            const isRingCapable = getDefaultRingCapable(deviceId);
            nodeData.isRingCapable = isRingCapable;
          }
          
          if (nodeData.maxStations === undefined) {
            const maxStations = getMaxStations(deviceId);
            if (maxStations > 0) nodeData.maxStations = maxStations;
          }
          
          // スイッチの光ポート数・イーサネットポート数（JSONに値がない場合のみ）
          if (stationType?.startsWith('switch-')) {
            if (nodeData.opticalPortCount === undefined) {
              const opticalInfo = getOpticalPortInfo(deviceId);
              nodeData.opticalPortCount = opticalInfo.opticalPortCount ?? 0;
            }
            if (nodeData.ethernetPortCount === undefined) {
              const totalPorts = nodeData.portCount ?? getDefaultPortCount(deviceId);
              const opticalPorts = nodeData.opticalPortCount ?? 0;
              nodeData.ethernetPortCount = totalPorts - opticalPorts;
            }
          }
          
          // ローカル・リモート局の場合は cycleSetting と cyclicDataBytes も設定
          if (nodeData.stationType === 'local' || nodeData.stationType === 'remote') {
            if (nodeData.cycleSetting === undefined) {
              const correctCycleSetting = getDefaultCycleSetting(deviceId);
              if (correctCycleSetting !== undefined) nodeData.cycleSetting = correctCycleSetting;
            }
            
            if (nodeData.cyclicDataBytes === undefined) {
              const correctCyclicDataBytes = getDefaultCyclicDataBytes(deviceId);
              if (correctCyclicDataBytes > 0) nodeData.cyclicDataBytes = correctCyclicDataBytes;
            }
            
            // RX, RWr, LB, LW も同様に処理（JSONに値がない場合のみ）
            if (nodeData.RX === undefined) nodeData.RX = 0;
            if (nodeData.RWr === undefined) nodeData.RWr = 0;
            if (nodeData.LB === undefined) nodeData.LB = 0;
            if (nodeData.LW === undefined) nodeData.LW = 0;
          }
          
          // マスタ局の場合の追加パラメータ
          if (nodeData.stationType === 'master') {
            if (nodeData.cyclicDataBytes === undefined) {
              const correctCyclicDataBytes = getDefaultCyclicDataBytes(deviceId);
              if (correctCyclicDataBytes > 0) nodeData.cyclicDataBytes = correctCyclicDataBytes;
            }
            if (nodeData.portsUsed === undefined) nodeData.portsUsed = 'single';
          }
        }
        
        // forbiddenPortsConfigured が配列の場合、Setに変換
        if (Array.isArray(nodeData.forbiddenPortsConfigured)) {
          nodeData.forbiddenPortsConfigured = new Set(nodeData.forbiddenPortsConfigured);
        } else if (nodeData.forbiddenPortsConfigured === undefined && (stationType?.startsWith('switch-') || stationType === 'ethernet-device')) {
          // スイッチ/Ethernet機器でforbiddenPortsConfiguredが未定義の場合は空のSetを設定
          nodeData.forbiddenPortsConfigured = new Set();
        }
        
        return {
          ...n,
          data: nodeData
        };
      });
      
      set({
        nodes: normNodes,
        edges: data.edges as Edge[],
        communicationMode: data.communicationMode ?? 'unicast', // デフォルトはユニキャスト
        history: [...history, snapshot].slice(-50),
        future: []
      });
      storage.save('flowchart:auto', get().toSerializable());
    }
  };
});
