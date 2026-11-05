// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { nanoid } from 'nanoid';
import RF, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  OnConnect,
  Panel,
  useReactFlow
} from 'reactflow';
import type { ReactFlowInstance } from 'reactflow';
import 'reactflow/dist/style.css';
import { getMasterDevice, getLocalRemoteDevice, getSwitchDevice, getEthernetDevice, getDefaultProtocolVersion } from '../utils/deviceDefaults';

import { useFlowStore } from '../store/flowStore';
import DeviceClassNode from './nodes/DeviceClassNode';
import DevicePalette from './DevicePalette';
import { ParameterDialog } from './ParameterDialog';
const NODE_TYPES = { deviceClass: DeviceClassNode };
import { Menu, MenuItem, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Divider, Alert, Snackbar, Select } from '@mui/material';
import { ValidationPanel } from './ValidationPanel';
import { validateNetwork } from '../services/rules';
import type { NetworkValidationResult, ValidationResult } from '../types/validation';
import type { CspDeviceSummary } from '../types/csp';
import { StationNumberDialog } from './StationNumberDialog';
import { generateLineWiring } from '../utils/autoWiring';
import { generateAutoLayout, detectTopology } from '../utils/autoLayout';
import { getMaxStations } from '../utils/maxStationsDict';
import { getDefaultPortCount, getOpticalPortInfo } from '../utils/portCountDict';
import { getPortType } from '../utils/portTypeDict';

// ヘルパー関数: マスタ・ローカル対応機器かどうか判定
const canBeMasterOrLocal = (deviceTypeDetailNormalized?: string) => {
  return deviceTypeDetailNormalized === 'マスタ・ローカルユニット' 
    || deviceTypeDetailNormalized === 'ネットワークインタフェースボード'
    || deviceTypeDetailNormalized === 'マスタ局専用ユニット';
  // 汎用ローカルユニットは除外（マスタ局に昇格不可）
};

// ヘルパー関数: 使用中の局番を取得
const getUsedStationNumbers = (nodes: Node[]): number[] => {
  return nodes
    .map(n => (n.data as any)?.stationNumber)
    .filter((num): num is number => typeof num === 'number');
};

// ヘルパー関数: 空いている局番を自動採番（1-253）
const allocateStationNumber = (usedNumbers: number[]): number | undefined => {
  for (let num = 1; num <= 253; num++) {
    if (!usedNumbers.includes(num)) {
      return num;
    }
  }
  return undefined; // 空き局番がない場合
};

// ヘルパー関数: ポート種別変更に伴う影響エッジを検出
const getAffectedEdgesByPortTypeChange = (
  selectedNodes: Node[], 
  newPortType: 'ethernet' | 'optical',
  allEdges: Edge[]
): Edge[] => {
  const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
  return allEdges.filter(edge => {
    // 選択ノードに接続されているエッジ
    if (selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)) {
      return true;
    }
    return false;
  });
};

export default function FlowEditor() {
  const { nodes, edges, communicationMode, setCommunicationMode, setNodes, setEdges, addNode, startNodeDrag, finalizeNodeDrag, setNodeDeviceClass, setNodeSpeed } = useFlowStore() as any;
  const { getNodes, getEdges } = useReactFlow(); // React Flow の最新状態取得用
  
  // デバッグ用: グローバルにエッジ確認関数を公開
  useEffect(() => {
    (window as any).debugEdges = () => {
      const currentEdges = getEdges();
      console.log('=== エッジ状態デバッグ ===');
      console.log('総エッジ数:', currentEdges.length);
      console.log('エッジ一覧:', currentEdges);
      currentEdges.forEach((edge: Edge, idx: number) => {
        console.log(`[${idx}] ID:${edge.id} | ${edge.source}[${edge.sourceHandle}] → ${edge.target}[${edge.targetHandle}]`);
      });
      return currentEdges;
    };
    (window as any).cleanGhostEdges = () => {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const nodeIds = new Set(currentNodes.map((n: Node) => n.id));
      const validEdges = currentEdges.filter((edge: Edge) => 
        nodeIds.has(edge.source) && nodeIds.has(edge.target)
      );
      const removedCount = currentEdges.length - validEdges.length;
      if (removedCount > 0) {
        console.log(`🧹 ${removedCount}個のゴーストエッジを削除しました`);
        setEdges(validEdges);
      } else {
        console.log('✅ ゴーストエッジは見つかりませんでした');
      }
    };
    console.log('💡 デバッグコマンド利用可能: window.debugEdges(), window.cleanGhostEdges()');
  }, [getNodes, getEdges, setEdges]);
  
  const [contextMenu, setContextMenu] = useState<{mouseX: number; mouseY: number; nodeId?: string; edgeId?: string} | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ nodeId: string; value: string } | null>(null);
  const [stationNumberDialog, setStationNumberDialog] = useState<{ nodeId: string; currentNumber: number } | null>(null);
  const [parameterDialog, setParameterDialog] = useState<{ nodeId: string } | null>(null);
  const [autoWiringConfirm, setAutoWiringConfirm] = useState(false);
  const [promoteToMasterConfirm, setPromoteToMasterConfirm] = useState<{ nodeId: string; currentMasterId?: string; replaceMode: 'delete' | 'demote'; affectedEdgesCount?: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ nodes: Node[]; edges: Edge[]; pasteCount: number } | null>(null);
  const [validationResult, setValidationResult] = useState<NetworkValidationResult | null>(null);
  const [validationPanelVisible, setValidationPanelVisible] = useState(false);
  const [duplicateDialog, setDuplicateDialog] = useState<{ nodeId: string; count: number } | null>(null);
  const [portTypeChangeConfirm, setPortTypeChangeConfirm] = useState<{ 
    selectedNodes: Node[]; 
    newDevice: any; 
    affectedEdges: Edge[];
    isNetworkDevice: boolean;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  // エッジ接続操作中フラグ: 接続開始～終了まで true とし、他UIのクリックを無効化する
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingSourceNodeId, setConnectingSourceNodeId] = useState<string | null>(null); // 接続開始元ノードID

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds: Node[]) => applyNodeChanges(changes, nds as Node[]));
      // ノードが移動したらパネルを閉じる
      if (changes.some(c => c.type === 'position' && c.dragging)) {
        setValidationPanelVisible(false);
      }
    },
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds: Edge[]) => applyEdgeChanges(changes, eds as Edge[]));
      // エッジが変更されたらパネルを閉じる
      setValidationPanelVisible(false);
    },
    [setEdges]
  );

  const LOGICAL_PORTS: string[] = Array.from({ length: 8 }, (_, i) => `port${i + 1}`);
  const OUT_SUFFIX = '_out';
  const IN_SUFFIX = '_in';
  const isOut = (h?: string | null): h is string => !!h && h.endsWith(OUT_SUFFIX);
  const isIn  = (h?: string | null): h is string => !!h && h.endsWith(IN_SUFFIX);
  const logicalFromHandle = (h?: string | null) => {
    if (!h) return null;
    for (const p of LOGICAL_PORTS) {
      if (h === p + OUT_SUFFIX || h === p + IN_SUFFIX) return p;
    }
    return null;
  };

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) return;
      
      // React Flow の最新のノード状態を取得
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      
      // ポート種別チェック: 光ポートとイーサネットポートは接続不可
      // スイッチの混在ポート対応: スイッチの場合はポート番号に基づいて判定
      const sourceNode = currentNodes.find((n: Node) => n.id === source);
      const targetNode = currentNodes.find((n: Node) => n.id === target);
      
      if (sourceNode && targetNode) {
        const sourceData = sourceNode.data as any;
        const targetData = targetNode.data as any;
        
        // ポート種別を判定する関数
        const getPortTypeForConnection = (nodeData: any, handleId: string): 'ethernet' | 'optical' => {
          const isSwitch = nodeData.stationType?.startsWith('switch-');
          
          if (isSwitch && nodeData.ethernetPortCount !== undefined && nodeData.opticalPortCount !== undefined) {
            // スイッチでポート構成が設定されている場合
            // handleId から logicalPort を抽出（例: "port1_out" → 1）
            const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
            return portNumber <= (nodeData.ethernetPortCount ?? 0) ? 'ethernet' : 'optical';
          } else {
            // 汎用機器またはCSP機器の場合
            return nodeData.portType || getPortType(nodeData.modelName || nodeData.label) || 'ethernet';
          }
        };
        
        const sourcePortType = getPortTypeForConnection(sourceData, sourceHandle);
        const targetPortType = getPortTypeForConnection(targetData, targetHandle);
        
        // スイッチのメディアコンバータ機能: 同一スイッチ内での光⇔イーサ変換はOK
        const isSameSwitch = sourceNode.id === targetNode.id;
        const isSwitch = sourceData.stationType?.startsWith('switch-') || targetData.stationType?.startsWith('switch-');
        
        if (sourcePortType !== targetPortType && !isSameSwitch) {
          setErrorMessage(null);
          setTimeout(() => {
            setErrorMessage('光ケーブルポートとイーサネットポートは接続できません');
          }, 10);
          return;
        }
      }
      
      // 論理ポートを取得（port1_out → port1, port2_in → port2）
      const sourceLogicalPort = logicalFromHandle(sourceHandle);
      const targetLogicalPort = logicalFromHandle(targetHandle);
      
      // 同じノードの同じポートへの接続を禁止（例: A[port1] → A[port1]）
      if (source === target && sourceLogicalPort === targetLogicalPort) {
        setErrorMessage(null);
        setTimeout(() => {
          setErrorMessage('同じポートへの接続はできません');
        }, 10);
        return;
      }
      
      // 1ポート1接続制限: 同じ論理ポートが既に使われているかチェック
      const conflictingEdge = currentEdges.find((edge: Edge) => {
        // 接続元ノードのポートチェック（sourceまたはtargetとして使われているか）
        if (edge.source === source) {
          const edgeSourceLogical = logicalFromHandle(edge.sourceHandle);
          if (edgeSourceLogical === sourceLogicalPort) return true;
        }
        if (edge.target === source) {
          const edgeTargetLogical = logicalFromHandle(edge.targetHandle);
          if (edgeTargetLogical === sourceLogicalPort) return true;
        }
        
        // 接続先ノードのポートチェック（sourceまたはtargetとして使われているか）
        if (edge.source === target) {
          const edgeSourceLogical = logicalFromHandle(edge.sourceHandle);
          if (edgeSourceLogical === targetLogicalPort) return true;
        }
        if (edge.target === target) {
          const edgeTargetLogical = logicalFromHandle(edge.targetHandle);
          if (edgeTargetLogical === targetLogicalPort) return true;
        }
        
        return false;
      });
      
      if (conflictingEdge) {
        console.warn('[onConnect] ポート競合検出:');
        console.warn('  新しい接続:', { source, sourceHandle, target, targetHandle });
        console.warn('  競合エッジ:', {
          id: conflictingEdge.id,
          source: conflictingEdge.source,
          sourceHandle: conflictingEdge.sourceHandle,
          target: conflictingEdge.target,
          targetHandle: conflictingEdge.targetHandle
        });
        console.warn('  論理ポート:', { sourceLogicalPort, targetLogicalPort });
        console.warn('  全エッジ数:', currentEdges.length);
        console.warn('  現在のノード数:', currentNodes.length);
        // エラーメッセージを一度クリアしてから再設定することで、連続エラー時も表示を更新
        setErrorMessage(null);
        setTimeout(() => {
          setErrorMessage('1つのポートには1本の接続しかできません');
        }, 10);
        return;
      }
      
      const newEdge: Edge = {
        id: nanoid(8),
        source,
        target,
        sourceHandle,
        targetHandle,
        style: { strokeWidth: 2, stroke: '#555' },
      };
      setEdges((eds: Edge[]) => addEdge(newEdge, eds));
      // エッジを追加したらパネルを閉じる
      setValidationPanelVisible(false);
    },
    [getNodes, getEdges, setEdges]
  );

  // 一括追加のハンドラー
  const handleBulkAdd = useCallback((device: CspDeviceSummary | any, count: number) => {
    console.log('[handleBulkAdd] device:', device, 'count:', count);
    if (!rfInstance || count < 1) return;
    
    // キャンバス中央の座標を取得
    const center = rfInstance.getViewport();
    const centerX = -center.x / center.zoom + (window.innerWidth - 260) / 2 / center.zoom; // 右パレット分を引く
    const centerY = -center.y / center.zoom + window.innerHeight / 2 / center.zoom;
    
    // 格子状配置の計算（横8列まで）
    const cols = Math.min(8, Math.ceil(Math.sqrt(count)));
    const spacing = 200; // 150pxから200pxに変更してノードの重なりを防ぐ
    const startX = centerX - (cols - 1) * spacing / 2;
    const startY = centerY - (Math.ceil(count / cols) - 1) * spacing / 2;
    
    // 既存の局番を取得
    const usedNumbers = (nodes as Node[])
      .map(n => (n.data as any)?.stationNumber)
      .filter((num): num is number => num != null && num > 0);
    
    // 既存のマスタ局の有無をチェック
    const hasMaster = (nodes as Node[]).some(n => (n.data as any)?.stationType === 'master');
    
    // 機器タイプの判定（優先順位: マスタ専用 > 汎用 > ネットワーク > CSP）
    const isMasterOnlyDevice = 'deviceTypeDetailNormalized' in device && device.deviceTypeDetailNormalized === 'マスタ局専用ユニット';
    const isGenericDevice = 'ports' in device; // 汎用機器判定
    const isNetworkDevice = 'stationType' in device && !isMasterOnlyDevice && !isGenericDevice; // ネットワーク機器判定
    const isCspDevice = !isMasterOnlyDevice && !isGenericDevice && !isNetworkDevice; // CSP機器判定
    const isLocalUnit = isCspDevice && canBeMasterOrLocal(device.deviceTypeDetailNormalized);
    const isGenericMaster = isGenericDevice && device.stationType === 'master';
    
    // マスタ局専用機器または汎用マスタ局で既にマスタ局がある場合は入れ替え確認
    if ((isMasterOnlyDevice || isGenericMaster) && hasMaster) {
      const currentMaster = (nodes as Node[]).find(n => (n.data as any)?.stationType === 'master');
      if (currentMaster) {
        // 追加ボタンからの追加処理を待機状態として保存
        const flowPos = { x: 100, y: 100 }; // デフォルト位置
        
        // ポート数チェック
        const oldPortCount = (currentMaster.data as any)?.portCount ?? 2;
        let newPortCount = 2;
        if (isGenericMaster) {
          newPortCount = (device as any).ports || 2;
        } else if (isMasterOnlyDevice) {
          const deviceDefaults = getMasterDevice((device as any).label || (device as any).id);
          newPortCount = deviceDefaults?.defaultPortCount ?? 2;
        }
        
        // 超過ポートのエッジ数をカウント
        let affectedEdgesCount = 0;
        if (newPortCount < oldPortCount) {
          const oldMasterEdges = (edges as Edge[]).filter(e => 
            e.source === currentMaster.id || e.target === currentMaster.id
          );
          oldMasterEdges.forEach(edge => {
            const handleId = edge.source === currentMaster.id ? edge.sourceHandle : edge.targetHandle;
            if (!handleId) return;
            
            const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
            if (portNumber > newPortCount) {
              affectedEdgesCount++;
            }
          });
        }
        
        if (isGenericMaster) {
          // 汎用マスタ局の場合
          (window as any).__pendingGenericBulkAdd = {
            genDev: device,
            flowPos,
            count
          };
        } else {
          // CSPマスタ局専用機器の場合
          (window as any).__pendingMasterBulkAdd = {
            masterDev: device,
            flowPos,
            count
          };
        }
        
        // 入れ替え確認ダイアログを表示
        setPromoteToMasterConfirm({ 
          nodeId: 'bulk-add-pending',
          currentMasterId: currentMaster.id,
          replaceMode: 'delete',
          affectedEdgesCount: affectedEdgesCount > 0 ? affectedEdgesCount : undefined
        });
        return;
      }
    }
    
    const newNodes: Node[] = [];
    for (let i = 0; i < count; i++) {
      // マスタ局専用機器または汎用マスタ局は1台のみ
      if ((isMasterOnlyDevice || isGenericMaster) && i > 0) break;
      
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = startX + col * spacing;
      const y = startY + row * spacing;
      
      const baseUrl = (import.meta as any).env?.BASE_URL ?? './';
      
      // 局番の自動採番
      let stationNumber: number | undefined;
      let stationType: string;
      let isMaster = false;
      
      // マスタ局専用機器の場合
      if (isMasterOnlyDevice) {
        stationType = 'master';
        stationNumber = 0;
        isMaster = true;
      } else if (isLocalUnit && !hasMaster && i === 0) {
        // マスタ・ローカルユニットで既存マスタがなく、1台目の場合はマスタ局として設定
        stationType = 'master';
        stationNumber = 0;
        isMaster = true;
      } else {
        stationType = isCspDevice 
          ? (isLocalUnit ? 'local' : 'remote')
          : device.stationType;
        
        if (stationType === 'master' || stationType === 'local' || stationType === 'remote') {
          if (stationType === 'master') {
            // マスタ局の場合はstationNumber = 0
            stationNumber = 0;
            isMaster = true; // isMasterフラグも確実に設定
          } else {
            // ローカル局・リモート局の場合は1-253から自動採番
            for (let num = 1; num <= 253; num++) {
              if (!usedNumbers.includes(num)) {
                stationNumber = num;
                usedNumbers.push(num);
                break;
              }
            }
          }
        }
      }
      
      if (isMasterOnlyDevice) {
        // マスタ局専用機器（MXコントローラ、モーションユニット）
        const dev = device as any; // MasterOnlyDevice型
        stationType = 'master';
        stationNumber = 0;
        isMaster = true;
        
        // device-defaults.json からデフォルト値を取得
        const deviceDefaults = getMasterDevice(dev.label || dev.id);
        
        const nodeData: any = {
          label: dev.label,
          imageUrl: dev.image ? baseUrl + dev.image : undefined,
          deviceClass: deviceDefaults?.defaultClass || 'B',
          deviceClassOptions: undefined, // Class変更不可
          speed: '1G',
          deviceSpeedOptions: ['100M', '1G'],
          isMaster: true,
          stationType: 'master',
          stationNumber: 0,
          deviceTypeDetailNormalized: dev.deviceTypeDetailNormalized,
          portCount: deviceDefaults?.defaultPortCount ?? 2,
          maxStations: dev.maxStations || getMaxStations(dev.label || dev.id)
        };
        
        // device-defaults.json の値をマージ
        if (deviceDefaults) {
          const fwVersion = deviceDefaults.firmwareVersion;
          nodeData.firmwareVersion = fwVersion && fwVersion !== '' ? Number(fwVersion) : undefined;
          const hwVersion = deviceDefaults.hardwareVersion;
          nodeData.hardwareVersion = hwVersion && hwVersion !== '' ? Number(hwVersion) : undefined;
          nodeData.protocolVersion = getDefaultProtocolVersion(dev.label || dev.id);
          nodeData.supportsMulticastFilter = deviceDefaults.supportsMulticastFilter;
          nodeData.isRingCapable = deviceDefaults.isRingCapable;
          nodeData.cyclicDataBytes = deviceDefaults.cyclicDataBytes;
        }
        
        newNodes.push({
          id: nanoid(6),
          type: 'deviceClass',
          position: { x, y },
          data: nodeData
        });
      } else if (isCspDevice) {
        // CSPデバイス
        const dev = device as CspDeviceSummary;
        
        // device-defaults.json からデフォルト値を取得（クラスもここから取得）
        const deviceDefaults = isMaster 
          ? getMasterDevice(dev.modelName)
          : getLocalRemoteDevice(dev.modelName);
        
        // device-defaults.json からクラスを取得（CSPではなくJSONを優先）
        const initialClass = deviceDefaults?.defaultClass || dev.classDefault || dev.class || 'A';
        
        // deviceClassOptions を device-defaults.json から生成
        let deviceClassOptions: ('A' | 'B')[] | undefined;
        if (deviceDefaults?.deviceClass) {
          const classStr = String(deviceDefaults.deviceClass);
          deviceClassOptions = classStr.includes(',') 
            ? classStr.split(',').map(c => c.trim() as 'A' | 'B')
            : undefined;
        } else {
          // device-defaults.json にない場合はCSPから取得
          deviceClassOptions = dev.classOptions;
        }
        
        let initialSpeed: '100M' | '1G' = '1G';
        if (dev.speedOptions && dev.speedOptions.length) {
          if (dev.speedOptions.includes('1G')) initialSpeed = '1G';
          if (!dev.speedOptions.includes('1G') && dev.speedOptions.includes('100M')) initialSpeed = '100M';
          if (dev.speedOptions.length === 1) initialSpeed = dev.speedOptions[0];
        }
        
        const opticalPortInfo = getOpticalPortInfo(dev.modelName);
        const nodeData: any = {
          label: dev.modelName,
          modelName: dev.modelName,
          portType: getPortType(dev.modelName),
          supportsOpticalPorts: opticalPortInfo.supportsOpticalPorts,
          defaultPortType: opticalPortInfo.defaultPortType,
          imageUrl: baseUrl + dev.image,
          deviceClass: initialClass,
          deviceClassOptions: deviceClassOptions,
          speed: initialSpeed,
          deviceSpeedOptions: dev.speedOptions,
          isMaster,
          stationType,
          stationNumber,
          deviceTypeDetailNormalized: dev.deviceTypeDetailNormalized,
          portCount: deviceDefaults?.defaultPortCount ?? 2,
          ...(dev.axisCount ? { axisCount: dev.axisCount } : {})
        };
        
        console.log('[handleBulkAdd] CSP node created:', { 
          modelName: dev.modelName, 
          axisCount: dev.axisCount,
          nodeDataAxisCount: nodeData.axisCount,
          stationType
        });
        
        // マスタ局の場合は最大接続局数を設定
        if (isMaster) {
          nodeData.maxStations = getMaxStations(dev.modelName);
        }
        
        // device-defaults.json の値をマージ
        if (deviceDefaults) {
          const fwVersion = deviceDefaults.firmwareVersion;
          nodeData.firmwareVersion = fwVersion && fwVersion !== '' ? Number(fwVersion) : undefined;
          const hwVersion = deviceDefaults.hardwareVersion;
          nodeData.hardwareVersion = hwVersion && hwVersion !== '' ? Number(hwVersion) : undefined;
          nodeData.protocolVersion = getDefaultProtocolVersion(dev.modelName);
          nodeData.supportsMulticastFilter = deviceDefaults.supportsMulticastFilter;
          nodeData.isRingCapable = deviceDefaults.isRingCapable;
          nodeData.cyclicDataBytes = deviceDefaults.cyclicDataBytes;
          
          // ローカ・リモート局の場合は cycleSetting も取得
          if (!isMaster && 'cycleSetting' in deviceDefaults) {
            nodeData.cycleSetting = deviceDefaults.cycleSetting;
          }
        }
        
        newNodes.push({
          id: nanoid(6),
          type: 'deviceClass',
          position: { x, y },
          data: nodeData
        });
      } else {
        // ネットワーク機器または汎用機器
        const isGenericDevice = 'ports' in device; // 汎用機器判定
        const isNetworkDevice = !isGenericDevice; // ネットワーク機器判定
        
        const nodeData: any = {
          label: device.label,
          imageUrl: device.image ? baseUrl + device.image : undefined,
          deviceClass: isGenericDevice ? device.deviceClass : undefined,
          deviceClassOptions: isGenericDevice && device.stationType === 'remote' ? ['A', 'B'] : undefined,
          speed: isGenericDevice ? device.speed : undefined,
          deviceSpeedOptions: isGenericDevice ? ['100M', '1G'] : undefined,
          isMaster: isGenericDevice && device.stationType === 'master',
          stationType: device.stationType,
          stationNumber,
          deviceTypeDetailNormalized: isGenericDevice 
            ? (device.stationType === 'master' ? 'マスタ局専用ユニット' : (device.stationType === 'local' ? 'マスタ・ローカルユニット' : undefined))
            : undefined,
          portCount: isGenericDevice ? device.ports : 2
        };
        
        // 追加ボタン経路は addNode と別にノードデータを作るため、switchType の初期値を揃える
        if (isNetworkDevice) {
          if (device.stationType === 'switch-classB') {
            nodeData.switchType = 'ClassB';
          } else if (device.stationType === 'switch-classA') {
            nodeData.switchType = 'ClassA';
          } else if (device.stationType === 'switch-general') {
            nodeData.switchType = 'General';
          } else if (device.stationType === 'ethernet-device') {
            // ドラッグ&ドロップ経路(addNode)と同じく通信速度の初期値を 1G にする
            nodeData.speed = '1G';
          }
        }

        // 汎用ローカル局のdeviceTypeDetailNormalizedを上書き（マスタ局昇格を防ぐ）
        if (isGenericDevice && device.stationType === 'local') {
          nodeData.deviceTypeDetailNormalized = '汎用ローカルユニット';
        }
        
        // ネットワーク機器の場合は device-defaults.json からデフォルト値を取得
        if (isNetworkDevice) {
          // device.id で device-defaults.json から検索
          const netDeviceDefaults = getSwitchDevice(device.id) || getEthernetDevice(device.id);
          
          if (netDeviceDefaults) {
            nodeData.portCount = netDeviceDefaults.defaultPortCount;
            nodeData.firmwareVersion = netDeviceDefaults.firmwareVersion && netDeviceDefaults.firmwareVersion !== '' ? Number(netDeviceDefaults.firmwareVersion) : undefined;
            nodeData.hardwareVersion = netDeviceDefaults.hardwareVersion && netDeviceDefaults.hardwareVersion !== '' ? Number(netDeviceDefaults.hardwareVersion) : undefined;
            nodeData.protocolVersion = netDeviceDefaults.protocolVersion;
            nodeData.supportsOpticalPorts = netDeviceDefaults.supportsOpticalPorts;
            nodeData.defaultPortType = netDeviceDefaults.defaultPortType;
            nodeData.cyclicDataBytes = netDeviceDefaults.cyclicDataBytes;
          }
        }
        
        // 汎用機器の場合も device-defaults.json からデフォルト値を取得
        if (isGenericDevice) {
          const genericDeviceId = device.stationType === 'master' ? 'generic-master' 
            : device.stationType === 'local' ? 'generic-local' 
            : 'generic-remote';
          
          // 汎用機器は master セクションに定義されているため、getMasterDevice または getLocalRemoteDevice を使用
          const genericDeviceDefaults = device.stationType === 'master' 
            ? getMasterDevice(genericDeviceId)
            : getLocalRemoteDevice(genericDeviceId);
          
          if (genericDeviceDefaults) {
            nodeData.portCount = genericDeviceDefaults.defaultPortCount;
            
            // deviceClass と deviceClassOptions を device-defaults.json から取得
            nodeData.deviceClass = genericDeviceDefaults.defaultClass;
            // deviceClass から deviceClassOptions を生成（カンマ区切りの場合は配列に変換）
            if (genericDeviceDefaults.deviceClass) {
              const classStr = String(genericDeviceDefaults.deviceClass);
              nodeData.deviceClassOptions = classStr.includes(',') 
                ? classStr.split(',').map(c => c.trim() as 'A' | 'B')
                : undefined;
            }
            
            // マスタ局の場合は最大接続局数を設定
            if (device.stationType === 'master') {
              nodeData.maxStations = getMaxStations(genericDeviceId);
            }
            
            nodeData.firmwareVersion = genericDeviceDefaults.firmwareVersion && genericDeviceDefaults.firmwareVersion !== '' ? Number(genericDeviceDefaults.firmwareVersion) : undefined;
            nodeData.protocolVersion = getDefaultProtocolVersion(genericDeviceId);
            nodeData.supportsMulticastFilter = genericDeviceDefaults.supportsMulticastFilter;
            nodeData.isRingCapable = genericDeviceDefaults.isRingCapable;
            nodeData.cyclicDataBytes = genericDeviceDefaults.cyclicDataBytes;
            
            // マスタ以外の場合は cycleSetting も取得
            if (device.stationType !== 'master' && 'cycleSetting' in genericDeviceDefaults) {
              nodeData.cycleSetting = genericDeviceDefaults.cycleSetting;
            }
          }
        }
        
        newNodes.push({
          id: nanoid(6),
          type: 'deviceClass',
          position: { x, y },
          data: nodeData
        });

      }
    }
    
    setNodes((nds: Node[]) => [...nds, ...newNodes]);
  }, [nodes, rfInstance, setNodes]);

  // 構成チェックの実行
  const executeValidation = useCallback(async () => {
    // すべてのノードの選択を解除
    setNodes((nds: Node[]) => nds.map(n => ({ ...n, selected: false })));
    
    // マスタ局の存在チェック
    const hasMaster = (nodes as Node[]).some(n => (n.data as any)?.stationType === 'master');
    
    if (!hasMaster) {
      // マスタ局が存在しない場合はエラー結果を返す
      const result: NetworkValidationResult = {
        valid: false,
        results: [{
          id: 'no-master',
          severity: 'error',
          status: 'DENY',
          message: 'マスタ局がありません',
          nodeIds: [],
          edgeIds: [],
          details: 'ネットワークにはマスタ局が1台必要です。マスタ局として使用できる機器を配置してください。'
        }],
        timestamp: Date.now()
      };
      setValidationResult(result);
      setValidationPanelVisible(true);
      return;
    }
    
    // 接続されていないノードのチェック（マスタから到達可能かどうか）
    const masterNode = (nodes as Node[]).find(n => (n.data as any)?.stationType === 'master');
    const allNodes = (nodes as Node[]);
    
    if (masterNode && allNodes.length > 1) {
      // マスタから到達可能なノードを探索（BFS）
      const reachableNodeIds = new Set<string>();
      const queue: string[] = [masterNode.id];
      reachableNodeIds.add(masterNode.id);
      
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        
        // 接続されているノードを探す
        (edges as Edge[]).forEach(e => {
          let nextId: string | null = null;
          if (e.source === currentId && !reachableNodeIds.has(e.target)) {
            nextId = e.target;
          } else if (e.target === currentId && !reachableNodeIds.has(e.source)) {
            nextId = e.source;
          }
          
          if (nextId) {
            reachableNodeIds.add(nextId);
            queue.push(nextId);
          }
        });
      }
      
      // マスタから到達できないノードを検出
      const unreachableNodes = allNodes.filter(n => !reachableNodeIds.has(n.id));
      
      if (unreachableNodes.length > 0) {
        const unreachableLabels = unreachableNodes.map(n => (n.data as any)?.label || 'Unknown').join(', ');
        // マスタから到達できないノードがある場合はエラーメッセージを表示
        setErrorMessage(`すべてのノードをマスタに接続してください。マスタから到達できないノード: ${unreachableLabels}`);
        return;
      }
    }
    
    const result = await validateNetwork(nodes, edges, communicationMode);
    setValidationResult(result);
    setValidationPanelVisible(true);
  }, [nodes, edges, communicationMode, setErrorMessage]);

  // 自動配線の実行
  const executeAutoWiring = useCallback(() => {
    const result = generateLineWiring(nodes as Node[]);
    
    if (!result.success) {
      setErrorMessage(result.error || '自動配線に失敗しました');
      return;
    }
    
    // 既存エッジを削除して新しいエッジを設定
    setEdges(() => result.edges);
    setAutoWiringConfirm(false);
  }, [nodes, setEdges]);

  // 自動配列の実行
  const executeAutoLayout = useCallback(() => {
    console.log('[executeAutoLayout] 実行開始', { nodesCount: nodes.length, edgesCount: edges.length });
    
    const hasMaster = (nodes as Node[]).some(n => (n.data as any)?.stationType === 'master');
    console.log('[executeAutoLayout] マスタ局チェック:', hasMaster);
    
    if (!hasMaster) {
      setErrorMessage('マスタ局がありません。自動配列を実行するにはマスタ局が必要です。');
      return;
    }
    
    // すべてのノードが接続されているかチェック
    const connectedNodeIds = new Set<string>();
    (edges as Edge[]).forEach(edge => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });
    
    const disconnectedNodes = (nodes as Node[]).filter(n => !connectedNodeIds.has(n.id));
    if (disconnectedNodes.length > 0) {
      setErrorMessage('すべてのノードを接続してください。接続されていないノードがあります。');
      return;
    }
    
    if (!rfInstance) {
      setErrorMessage('キャンバスの情報を取得できません。');
      return;
    }
    
    // トポロジを判定して適切なレイアウトを適用
    const topology = detectTopology(nodes as Node[], edges as Edge[]);
    console.log('[executeAutoLayout] 検出されたトポロジ:', topology);
    
    // 現在のキャンバスの表示位置を取得
    const viewport = rfInstance.getViewport();
    const layoutedNodes = generateAutoLayout(nodes as Node[], edges as Edge[], viewport);
    console.log('[executeAutoLayout] レイアウト完了', { layoutedNodesCount: layoutedNodes.length, topology });
    
    // setNodesに関数形式で渡す
    setNodes(() => layoutedNodes);
    setValidationPanelVisible(false);
  }, [nodes, edges, setNodes, rfInstance]);

  // 複製（数量指定）の実行
  const executeDuplicate = useCallback(() => {
    if (!duplicateDialog) return;
    
    const sourceNode = (nodes as Node[]).find(n => n.id === duplicateDialog.nodeId);
    if (!sourceNode) return;
    
    const count = duplicateDialog.count;
    const spacing = 200; // 150pxから200pxに変更してノードの重なりを防ぐ
    const cols = Math.min(8, Math.ceil(Math.sqrt(count)));
    
    // 既存の局番を取得
    const usedNumbers = (nodes as Node[])
      .map(n => (n.data as any)?.stationNumber)
      .filter((num): num is number => num != null && num > 0);
    
    const newNodes: Node[] = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const offsetX = col * spacing;
      const offsetY = row * spacing;
      
      const data = sourceNode.data as any;
      
      // マスタ局はローカル局に変換
      let stationType = data.stationType;
      if (stationType === 'master') {
        stationType = 'local';
      }
      
      // 局番を自動採番
      let stationNumber: number | undefined;
      if (stationType === 'master' || stationType === 'local' || stationType === 'remote') {
        for (let num = 1; num <= 253; num++) {
          if (!usedNumbers.includes(num)) {
            stationNumber = num;
            usedNumbers.push(num);
            break;
          }
        }
      }
      
      newNodes.push({
        ...sourceNode,
        id: nanoid(6),
        position: {
          x: sourceNode.position.x + offsetX + spacing,
          y: sourceNode.position.y + offsetY
        },
        data: {
          ...data,
          isMaster: false,
          stationType,
          stationNumber
        }
      });
    }
    
    setNodes((nds: Node[]) => [...nds, ...newNodes]);
    setDuplicateDialog(null);
  }, [duplicateDialog, nodes, setNodes]);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu(
      contextMenu === null
        ? { mouseX: event.clientX + 2, mouseY: event.clientY - 6, nodeId: node.id }
        : null
    );
  }, [contextMenu]);

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    // エッジが1本だけ選択されている場合のみメニューを表示
    const selectedEdges = (edges as Edge[]).filter(e => e.selected);
    if (selectedEdges.length === 1 && selectedEdges[0].id === edge.id) {
      setContextMenu(
        contextMenu === null
          ? { mouseX: event.clientX + 2, mouseY: event.clientY - 6, edgeId: edge.id }
          : null
      );
    }
  }, [contextMenu, edges]);

  const handleNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const currentLabel = (node.data as any)?.label ?? '';
    setRenameTarget({ nodeId: node.id, value: currentLabel });
  }, []);

  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // 検証パネルを閉じる
    setValidationPanelVisible(false);
    
    const now = performance.now();
    if (lastClickRef.current && lastClickRef.current.id === node.id && (now - lastClickRef.current.time) < 300) {
      event.preventDefault();
      const currentLabel = (node.data as any)?.label ?? '';
      setRenameTarget({ nodeId: node.id, value: currentLabel });
      lastClickRef.current = null;
    } else {
      lastClickRef.current = { id: node.id, time: now };
    }
  }, []);

  const closeMenu = () => setContextMenu(null);
  
  // 局番変更ハンドラー
  const handleChangeStationNumber = (nodeId: string, newNumber: number) => {
    setNodes((nds: Node[]) => {
      // 重複チェック: 新しい番号を使っているノードを探す
      const duplicateNode = nds.find(n => {
        if (n.id === nodeId) return false;
        return (n.data as any)?.stationNumber === newNumber;
      });
      
      if (duplicateNode) {
        // 入れ替え: 対象ノードの旧番号を重複ノードに設定
        const targetNode = nds.find(n => n.id === nodeId);
        const oldNumber = (targetNode?.data as any)?.stationNumber;
        
        return nds.map(n => {
          if (n.id === nodeId) {
            // 対象ノード: 新しい番号を設定
            return { ...n, data: { ...(n.data as any), stationNumber: newNumber } };
          } else if (n.id === duplicateNode.id) {
            // 重複ノード: 旧番号を設定
            return { ...n, data: { ...(n.data as any), stationNumber: oldNumber } };
          }
          return n;
        });
      } else {
        // 重複なし: そのまま変更
        return nds.map(n => 
          n.id === nodeId 
            ? { ...n, data: { ...(n.data as any), stationNumber: newNumber } }
            : n
        );
      }
    });
  };
  
  const changeClass = (cls: 'A' | 'B') => {
    if (contextMenu) {
      const node = (nodes as Node[]).find(n => n.id === contextMenu.nodeId);
      const opts = (node?.data as any)?.deviceClassOptions;
      if (!opts || opts.includes(cls)) setNodeDeviceClass(contextMenu.nodeId, cls);
    }
    closeMenu();
  };
  const chooseSpeed = (sp: '100M' | '1G') => {
    if (contextMenu) {
      const node = (nodes as Node[]).find(n => n.id === contextMenu.nodeId);
      const opts: ('100M' | '1G')[] | undefined = (node?.data as any)?.deviceSpeedOptions;
      if (!opts || opts.includes(sp)) setNodeSpeed(contextMenu.nodeId, sp);
    }
    closeMenu();
  };

  const saveRename = () => {
    if (!renameTarget) return;
    const { nodeId, value } = renameTarget;
    setNodes((nds: Node[]) => nds.map(n => n.id === nodeId ? { ...n, data: { ...(n.data as any), label: value } } : n));
    setRenameTarget(null);
  };
  const cancelRename = () => setRenameTarget(null);

  // TSN機器変更を適用する共通関数
  // マスタ専用機器変更を適用する関数
  const applyMasterOnlyChange = useCallback((masterDev: any) => {
    setNodes((nds: Node[]) => {
      const selected = nds.filter(n => n.selected);
      if (!selected.length) return nds;
      
      const hasMaster = nds.some(n => (n.data as any)?.isMaster && !n.selected);
      if (hasMaster) {
        setErrorMessage('マスタ局は1台のみ配置可能です。既存のマスタ局を削除してから追加してください。');
        return nds;
      }
      return nds.map(n => n.selected ? {
        ...n,
        data: {
          label: masterDev.label,
          imageUrl: undefined,
          deviceClass: 'B',
          deviceClassOptions: undefined,
          speed: '1G',
          deviceSpeedOptions: ['100M', '1G'],
          isMaster: true,
          stationType: 'master',
          stationNumber: 0,
          deviceTypeDetailNormalized: masterDev.deviceTypeDetailNormalized,
          portCount: getDefaultPortCount(masterDev.label),
          maxStations: getMaxStations(masterDev.label),
          portType: 'ethernet'
        }
      } : n);
    });
  }, [setNodes, setErrorMessage]);

  // 汎用機器変更を適用する関数
  const applyGenericChange = useCallback((genDev: any) => {
    setNodes((nds: Node[]) => {
      const selected = nds.filter(n => n.selected);
      if (!selected.length) return nds;
      
      if (genDev.stationType === 'master') {
        const hasMaster = nds.some(n => (n.data as any)?.isMaster && !n.selected);
        if (hasMaster) {
          setErrorMessage('マスタ局は1台のみ配置可能です。既存のマスタ局を削除してから追加してください。');
          return nds;
        }
      }
      
      const canChangeClass = genDev.stationType === 'remote';
      const usedNumbers = getUsedStationNumbers(nds.filter(n => !n.selected));
      
      return nds.map(n => {
        if (!n.selected) return n;
        
        const currentData = n.data as any;
        const wasMaster = currentData.isMaster;
        const willBeMaster = genDev.stationType === 'master';
        
        let newStationNumber: number | undefined;
        if (willBeMaster) {
          newStationNumber = 0;
        } else if (wasMaster && !willBeMaster) {
          newStationNumber = allocateStationNumber(usedNumbers);
          if (newStationNumber !== undefined) {
            usedNumbers.push(newStationNumber);
          }
        } else {
          newStationNumber = currentData.stationNumber;
        }
        
        return {
          ...n,
          data: {
            label: genDev.label,
            imageUrl: undefined,
            deviceClass: genDev.deviceClass,
            deviceClassOptions: canChangeClass ? ['A', 'B'] : undefined,
            speed: genDev.speed,
            deviceSpeedOptions: ['100M', '1G'],
            isMaster: willBeMaster,
            stationType: genDev.stationType,
            stationNumber: newStationNumber,
            deviceTypeDetailNormalized: willBeMaster ? 'マスタ局専用ユニット' : undefined,
            portCount: genDev.ports,
            maxStations: willBeMaster ? undefined : undefined,
            portType: 'ethernet'
          }
        };
      });
    });
  }, [setNodes, setErrorMessage]);

  // パラメータ設定の保存
  const handleSaveParameters = useCallback((params: any) => {
    if (!parameterDialog) return;
    const { nodeId } = parameterDialog;
    
    const targetNode = (nodes as Node[]).find(n => n.id === nodeId);
    if (!targetNode) return;
    
    const nodeData = targetNode.data as any;
    const isSwitch = nodeData.stationType?.startsWith('switch-');
    const isGenericDevice = !nodeData.modelName && !isSwitch;
    
    // ポート種別変更の影響を受けるエッジを検出
    const affectedEdges: Edge[] = [];
    
    // スイッチのポート構成変更をチェック
    if (isSwitch && (params.opticalPortCount !== undefined || params.ethernetPortCount !== undefined)) {
      const oldOptical = nodeData.opticalPortCount ?? 0;
      const oldEthernet = nodeData.ethernetPortCount ?? (nodeData.portCount ?? 2);
      const newOptical = params.opticalPortCount ?? 0;
      const newEthernet = params.ethernetPortCount ?? (params.portCount ?? 2);
      
      // ポート構成が変更された場合のみチェック
      if (oldOptical !== newOptical || oldEthernet !== newEthernet) {
        (edges as Edge[]).forEach(edge => {
          if (edge.source === nodeId || edge.target === nodeId) {
            const handleId = edge.source === nodeId ? edge.sourceHandle : edge.targetHandle;
            if (!handleId) return;
            
            // ポート番号を取得
            const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
            
            // 旧構成でのポート種別
            const oldPortType = portNumber <= oldEthernet ? 'ethernet' : 'optical';
            // 新構成でのポート種別
            const newPortType = portNumber <= newEthernet ? 'ethernet' : 'optical';
            
            // ポート種別が変更された場合
            if (oldPortType !== newPortType) {
              // 接続先のポート種別を確認
              const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
              const otherNode = (nodes as Node[]).find(n => n.id === otherNodeId);
              if (otherNode) {
                const otherData = otherNode.data as any;
                const otherHandleId = edge.source === nodeId ? edge.targetHandle : edge.sourceHandle;
                const otherIsSwitch = otherData.stationType?.startsWith('switch-');
                
                let otherPortType: 'ethernet' | 'optical';
                if (otherIsSwitch && otherData.ethernetPortCount !== undefined) {
                  const otherPortNumber = parseInt((otherHandleId || '').replace(/^port(\d+)_(in|out)$/, '$1'));
                  otherPortType = otherPortNumber <= (otherData.ethernetPortCount ?? 0) ? 'ethernet' : 'optical';
                } else {
                  otherPortType = otherData.portType || getPortType(otherData.modelName || otherData.label) || 'ethernet';
                }
                
                // 新しいポート種別と接続先が一致しない場合、削除対象
                if (newPortType !== otherPortType) {
                  affectedEdges.push(edge);
                }
              }
            }
          }
        });
      }
    }
    
    // 汎用機器のポート種別変更をチェック
    if (isGenericDevice && params.portType !== undefined && params.portType !== nodeData.portType) {
      const newPortType = params.portType;
      
      (edges as Edge[]).forEach(edge => {
        if (edge.source === nodeId || edge.target === nodeId) {
          const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
          const otherNode = (nodes as Node[]).find(n => n.id === otherNodeId);
          if (otherNode) {
            const otherData = otherNode.data as any;
            const otherHandleId = edge.source === nodeId ? edge.targetHandle : edge.sourceHandle;
            const otherIsSwitch = otherData.stationType?.startsWith('switch-');
            
            let otherPortType: 'ethernet' | 'optical';
            if (otherIsSwitch && otherData.ethernetPortCount !== undefined) {
              const otherPortNumber = parseInt((otherHandleId || '').replace(/^port(\d+)_(in|out)$/, '$1'));
              otherPortType = otherPortNumber <= (otherData.ethernetPortCount ?? 0) ? 'ethernet' : 'optical';
            } else {
              otherPortType = otherData.portType || getPortType(otherData.modelName || otherData.label) || 'ethernet';
            }
            
            // 新しいポート種別と接続先が一致しない場合、削除対象
            if (newPortType !== otherPortType) {
              affectedEdges.push(edge);
            }
          }
        }
      });
    }
    
    // 影響を受けるエッジがある場合は確認ダイアログを表示
    if (affectedEdges.length > 0) {
      setConfirmDialog({
        title: 'ポート種別変更の確認',
        message: `ポート種別を変更すると、以下の${affectedEdges.length}件の接続が削除されます。よろしいですか？`,
        onConfirm: () => {
          // エッジを削除してパラメータを保存
          setEdges((eds: Edge[]) => eds.filter(e => !affectedEdges.find(ae => ae.id === e.id)));
          setNodes((nds: Node[]) => nds.map(n => n.id === nodeId ? { ...n, data: { ...(n.data as any), ...params } } : n));
          setConfirmDialog(null);
          setParameterDialog(null);
        },
        onCancel: () => {
          setConfirmDialog(null);
        }
      });
    } else {
      // 影響がない場合はそのまま保存
      setNodes((nds: Node[]) => nds.map(n => n.id === nodeId ? { ...n, data: { ...(n.data as any), ...params } } : n));
      setParameterDialog(null);
    }
  }, [parameterDialog, setNodes, nodes, edges, setEdges]);

  // マスタ局入れ替えの実行
  const executePromoteToMaster = useCallback(() => {
    if (!promoteToMasterConfirm) return;
    
    const { nodeId, currentMasterId, replaceMode } = promoteToMasterConfirm;
    const portTypeChangedInfo = (window as any).__portTypeChanged;
    
    // ドロップ待機中の処理
    if (nodeId === 'drop-pending') {
      const pendingDrop = (window as any).__pendingMasterDeviceDrop;
      const pendingGenericDrop = (window as any).__pendingGenericDeviceDrop;
      
      if (pendingDrop) {
        const { masterDev, flowPos } = pendingDrop;
        
        // 旧マスタ局の位置とポート数を取得
        const oldMaster = (nodes as Node[]).find(n => n.id === currentMasterId);
        const targetPos = oldMaster?.position || flowPos;
        const oldPortCount = (oldMaster?.data as any)?.portCount ?? 2;
        
        // 新マスタ局のポート数を取得
        const deviceDefaults = getMasterDevice(masterDev.label || masterDev.id);
        const newPortCount = deviceDefaults?.defaultPortCount ?? 2;
        
        // 旧マスタ局のエッジを取得
        let oldMasterEdges = (edges as Edge[]).filter(e => 
          e.source === currentMasterId || e.target === currentMasterId
        );
        
        // ポート種別が変更される場合は、該当エッジを除外
        if (portTypeChangedInfo?.affectedEdges) {
          const toRemoveIds = new Set(portTypeChangedInfo.affectedEdges.map((e: Edge) => e.id));
          oldMasterEdges = oldMasterEdges.filter(e => !toRemoveIds.has(e.id));
        }
        
        // ポート数が減少する場合、超過ポートに接続されているエッジを除外
        if (newPortCount < oldPortCount) {
          oldMasterEdges = oldMasterEdges.filter(edge => {
            const handleId = edge.source === currentMasterId ? edge.sourceHandle : edge.targetHandle;
            if (!handleId) return true;
            const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
            return portNumber <= newPortCount;
          });
        }
        
        // 旧マスタ局を削除
        setNodes((nds: Node[]) => nds.filter(n => n.id !== currentMasterId));
        setEdges((eds: Edge[]) => eds.filter(e => e.source !== currentMasterId && e.target !== currentMasterId));
        
        // 新しいマスタ局を追加（旧マスタの位置に配置）
        const pseudoDev: CspDeviceSummary = {
          id: masterDev.id,
          modelName: masterDev.label,
          image: masterDev.image,
          deviceTypeDetailNormalized: masterDev.deviceTypeDetailNormalized
        };
        const newNodeId = addNode(targetPos, pseudoDev);
        
        // エッジを新マスタIDに付け替えて復元
        setEdges((eds: Edge[]) => {
          const restoredEdges = oldMasterEdges.map((e, index) => ({
            ...e,
            id: `${newNodeId}-edge-${index}`,
            source: e.source === currentMasterId ? newNodeId : e.source,
            target: e.target === currentMasterId ? newNodeId : e.target
          }));
          return [...eds, ...restoredEdges];
        });
        
        // クリーンアップ
        delete (window as any).__pendingMasterDeviceDrop;
      } else if (pendingGenericDrop) {
        const { genDev, flowPos } = pendingGenericDrop;
        
        // 旧マスタ局の位置とポート数を取得
        const oldMaster = (nodes as Node[]).find(n => n.id === currentMasterId);
        const targetPos = oldMaster?.position || flowPos;
        const oldPortCount = (oldMaster?.data as any)?.portCount ?? 2;
        
        // 新マスタ局のポート数を取得
        const newPortCount = genDev.ports || 2;
        
        // 旧マスタ局のエッジを取得
        let oldMasterEdges = (edges as Edge[]).filter(e => 
          e.source === currentMasterId || e.target === currentMasterId
        );
        
        // ポート種別が変更される場合は、該当エッジを除外
        if (portTypeChangedInfo?.affectedEdges) {
          const toRemoveIds = new Set(portTypeChangedInfo.affectedEdges.map((e: Edge) => e.id));
          oldMasterEdges = oldMasterEdges.filter(e => !toRemoveIds.has(e.id));
        }
        
        // ポート数が減少する場合、超過ポートに接続されているエッジを除外
        if (newPortCount < oldPortCount) {
          oldMasterEdges = oldMasterEdges.filter(edge => {
            const handleId = edge.source === currentMasterId ? edge.sourceHandle : edge.targetHandle;
            if (!handleId) return true;
            const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
            return portNumber <= newPortCount;
          });
        }
        
        // 旧マスタ局を削除
        setNodes((nds: Node[]) => nds.filter(n => n.id !== currentMasterId));
        setEdges((eds: Edge[]) => eds.filter(e => e.source !== currentMasterId && e.target !== currentMasterId));
        
        // 新しい汎用マスタ局を追加（クラスB固定）
        const pseudoDev: CspDeviceSummary = {
          id: genDev.id,
          modelName: genDev.label,
          image: genDev.image,
          deviceTypeDetailNormalized: 'マスタ局専用ユニット',
          classDefault: genDev.deviceClass,
          classOptions: undefined,
          speedOptions: ['100M', '1G']
        };
        const newNodeId = addNode(targetPos, pseudoDev);
        
        // エッジを新マスタIDに付け替えて復元
        setEdges((eds: Edge[]) => {
          const restoredEdges = oldMasterEdges.map((e, index) => ({
            ...e,
            id: `${newNodeId}-edge-${index}`,
            source: e.source === currentMasterId ? newNodeId : e.source,
            target: e.target === currentMasterId ? newNodeId : e.target
          }));
          return [...eds, ...restoredEdges];
        });
        
        // クリーンアップ
        delete (window as any).__pendingGenericDeviceDrop;
      }
      delete (window as any).__portTypeChanged;
      setPromoteToMasterConfirm(null);
      return;
    }
    
    // 追加ボタンからの待機中の処理
    if (nodeId === 'bulk-add-pending') {
      const pendingMasterBulkAdd = (window as any).__pendingMasterBulkAdd;
      const pendingGenericBulkAdd = (window as any).__pendingGenericBulkAdd;
      
      if (pendingMasterBulkAdd || pendingGenericBulkAdd) {
        const device = pendingMasterBulkAdd ? pendingMasterBulkAdd.masterDev : pendingGenericBulkAdd.genDev;
        const flowPos = pendingMasterBulkAdd ? pendingMasterBulkAdd.flowPos : pendingGenericBulkAdd.flowPos;
        
        // 旧マスタ局の位置とポート数を取得
        const oldMaster = (nodes as Node[]).find(n => n.id === currentMasterId);
        const targetPos = oldMaster?.position || flowPos;
        const oldPortCount = (oldMaster?.data as any)?.portCount ?? 2;
        
        // 新マスタ局のポート数を取得
        let newPortCount = 2;
        if (pendingGenericBulkAdd) {
          newPortCount = pendingGenericBulkAdd.genDev.ports || 2;
        } else if (pendingMasterBulkAdd) {
          const deviceDefaults = getMasterDevice(device.label || device.id);
          newPortCount = deviceDefaults?.defaultPortCount ?? 2;
        }
        
        // 旧マスタ局のエッジを取得
        let oldMasterEdges = (edges as Edge[]).filter(e => 
          e.source === currentMasterId || e.target === currentMasterId
        );
        
        // ポート数が減少する場合、超過ポートに接続されているエッジを除外
        if (newPortCount < oldPortCount) {
          oldMasterEdges = oldMasterEdges.filter(edge => {
            const handleId = edge.source === currentMasterId ? edge.sourceHandle : edge.targetHandle;
            if (!handleId) return true;
            
            const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
            return portNumber <= newPortCount;
          });
        }
        
        // 旧マスタ局を削除
        setNodes((nds: Node[]) => nds.filter(n => n.id !== currentMasterId));
        setEdges((eds: Edge[]) => eds.filter(e => e.source !== currentMasterId && e.target !== currentMasterId));
        
        // マスタ局入れ替えの完了処理
        if (pendingGenericBulkAdd) {
          // 汎用マスタ局の場合
          const genDev = pendingGenericBulkAdd.genDev;
          const pseudoDev: CspDeviceSummary = {
            id: genDev.id,
            modelName: genDev.label,
            image: genDev.image,
            deviceTypeDetailNormalized: 'マスタ局専用ユニット',
            classDefault: genDev.deviceClass,
            classOptions: undefined,
            speedOptions: ['100M', '1G']
          };
          const newNodeId = addNode(targetPos, pseudoDev);
          
          // エッジを新マスタIDに付け替えて復元
          setEdges((eds: Edge[]) => {
            const restoredEdges = oldMasterEdges.map((e, index) => ({
              ...e,
              id: `${newNodeId}-edge-${index}`,
              source: e.source === currentMasterId ? newNodeId : e.source,
              target: e.target === currentMasterId ? newNodeId : e.target
            }));
            return [...eds, ...restoredEdges];
          });
        } else if (pendingMasterBulkAdd) {
          // CSPマスタ局専用機器の場合
          const masterDev = pendingMasterBulkAdd.masterDev;
          const pseudoDev: CspDeviceSummary = {
            id: masterDev.id,
            modelName: masterDev.label || masterDev.modelName,
            image: masterDev.image || '',
            deviceTypeDetailNormalized: masterDev.deviceTypeDetailNormalized
          };
          const newNodeId = addNode(targetPos, pseudoDev);
          
          // エッジを新マスタIDに付け替えて復元
          setEdges((eds: Edge[]) => {
            const restoredEdges = oldMasterEdges.map((e, index) => ({
              ...e,
              id: `${newNodeId}-edge-${index}`,
              source: e.source === currentMasterId ? newNodeId : e.source,
              target: e.target === currentMasterId ? newNodeId : e.target
            }));
            return [...eds, ...restoredEdges];
          });
        }
        
        // クリーンアップ
        delete (window as any).__pendingMasterBulkAdd;
        delete (window as any).__pendingGenericBulkAdd;
      }
      
      setPromoteToMasterConfirm(null);
      return;
    }
    
    if (replaceMode === 'delete') {
      // 削除モード：旧マスタ局を削除して新マスタを設定
      // 旧マスタの位置とエッジを新マスタに引き継ぐ
      setNodes((nds: Node[]) => {
        const oldMaster = nds.find(n => n.id === currentMasterId);
        const oldPosition = oldMaster?.position || { x: 0, y: 0 };
        
        return nds
          .filter(n => n.id !== currentMasterId) // 旧マスタ局を削除
          .map(n => {
            if (n.id === nodeId) {
              // 新しいマスタ局に設定し、旧マスタの位置に配置
              const modelName = (n.data as any)?.label;
              const maxStations = modelName ? getMaxStations(modelName) : undefined;
              return {
                ...n,
                position: oldPosition,
                data: {
                  ...(n.data as any),
                  isMaster: true,
                  stationType: 'master',
                  stationNumber: 0,
                  maxStations
                }
              };
            }
            return n;
          });
      });
      // エッジのsource/targetを旧マスタIDから新マスタIDに付け替え
      setEdges((eds: Edge[]) => {
        return eds.map(e => {
          const newEdge = { ...e };
          if (e.source === currentMasterId) {
            newEdge.source = nodeId;
          }
          if (e.target === currentMasterId) {
            newEdge.target = nodeId;
          }
          return newEdge;
        });
      });
    } else {
      // 降格モード：旧マスタ局をローカル局に降格
      setNodes((nds: Node[]) => {
        const currentMaster = nds.find(n => n.id === currentMasterId);
        const targetNode = nds.find(n => n.id === nodeId);
        const targetStationNumber = (targetNode?.data as any)?.stationNumber;
        
        return nds.map(n => {
          const isMaster = n.id === nodeId;
          const currentData = n.data as any;
          let newStationType: 'master' | 'local' | 'remote';
          let newStationNumber = currentData.stationNumber;
          let maxStations = currentData.maxStations; // 既存の値を保持
          
          if (isMaster) {
            // 新しいマスタ局に設定
            newStationType = 'master';
            newStationNumber = 0; // 新マスタはNo.0
            // maxStationsを型名から取得
            const modelName = currentData.label;
            maxStations = modelName ? getMaxStations(modelName) : undefined;
          } else if (currentMaster && n.id === currentMaster.id) {
            // 旧マスタ局: ローカル局に降格し、新マスタの旧局番を引き継ぐ
            newStationType = canBeMasterOrLocal(currentData.deviceTypeDetailNormalized) ? 'local' : 'remote';
            newStationNumber = targetStationNumber ?? currentData.stationNumber;
            // ローカル局に降格するのでmaxStationsはクリア
            maxStations = undefined;
          } else {
            // その他のノード: 変更なし
            newStationType = currentData.stationType;
          }
          
          return {
            ...n,
            data: {
              ...currentData,
              isMaster,
              stationType: newStationType,
              stationNumber: newStationNumber,
              maxStations
            }
          };
        });
      });
    }
    
    delete (window as any).__portTypeChanged;
    setPromoteToMasterConfirm(null);
  }, [promoteToMasterConfirm, setNodes, setEdges, addNode]);

  const changePortCount = (nodeId: string, count: number) => {
    console.log(`[changePortCount] nodeId=${nodeId}, count=${count}`);
    setNodes((nds: Node[]) => {
      const updated = nds.map(n => {
        if (n.id === nodeId) {
          const newNode = { ...n, data: { ...(n.data as any), portCount: count } };
          console.log(`  Updated node ${nodeId}: portCount=${count}`);
          return newNode;
        }
        return n;
      });
      return updated;
    });
    
    // React Flowに強制的に再レンダリングさせるため、少し待ってからもう一度更新
    setTimeout(() => {
      setNodes((nds: Node[]) => [...nds]);
    }, 0);
  };

  const nodeTypes = NODE_TYPES;
  
  const displayNodes = (nodes as Node[]).map(n => {
    const data = (n.data as any) || {};
    
    // portCountはストアの値をそのまま使う（未定義の場合のみデフォルト2）
    const finalPortCount = data.portCount ?? 2;
    
    const baseData = {
      ...data,
      portCount: finalPortCount,
      isConnecting,
      connectingSourceNodeId,
      onStationNumberClick: (nodeId: string, currentNumber: number) => {
        setStationNumberDialog({ nodeId, currentNumber });
        setValidationPanelVisible(false);
      },
      onCloseValidationPanel: () => setValidationPanelVisible(false),
    };
    
    // デバッグ: portCount変更を確認
    if (data.stationType === 'master' || (data.stationType && data.stationType.startsWith('switch-'))) {
      console.log(`[displayNodes] ${data.stationType} ${n.id}: portCount=${data.portCount} → finalPortCount=${finalPortCount}`);
    }
    
    // React Flowに新しいノードとして認識させるため、idにportCountを含める
    // ただし、これはエッジのsource/targetに影響するので、別のアプローチを使う
    return { 
      ...n,
      id: n.id, // IDは変えない
      data: baseData,
      type: 'deviceClass',
      // React Flow内部で使用される識別子としてportCountを含める
      selected: n.selected,
      dragging: n.dragging,
      // 強制的に再マウントさせるためにdataの参照を完全に変える
    };
  });

  // 表示用のエッジ: 検証結果に応じてスタイルを変更
  const displayEdges = useMemo(() => {
    return (edges as Edge[]).map((edge) => {
      // スイッチなしエラーの判定
      const isNoSwitchError = (r: ValidationResult) => {
        return r.severity === 'warning' && 
               (r.status === 'ALLOW_VIA_SWITCH' || r.status === 'ALLOW_VIA_SWITCH_PENDING') &&
               r.message?.includes('産業用スイッチ経由が必要');
      };
      
      const errorResult = validationResult?.results.find(r => 
        (r.severity === 'error' || isNoSwitchError(r)) && r.edgeIds?.includes(edge.id)
      );
      const warningResult = validationResult?.results.find(r => 
        r.severity === 'warning' && !isNoSwitchError(r) && r.edgeIds?.includes(edge.id)
      );
      
      // 光ケーブル判定: 接続されている両ノードのポート種別を確認
      const sourceNode = nodes.find((n: Node) => n.id === edge.source);
      const targetNode = nodes.find((n: Node) => n.id === edge.target);
      
      // ポート種別を判定（スイッチの混在ポート対応）
      const getEdgePortType = (nodeData: any, handleId: string | undefined | null): 'ethernet' | 'optical' => {
        if (!handleId) return 'ethernet';
        
        const isSwitch = nodeData.stationType?.startsWith('switch-');
        
        if (isSwitch && nodeData.ethernetPortCount !== undefined && nodeData.opticalPortCount !== undefined) {
          // スイッチでポート構成が設定されている場合
          const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
          return portNumber <= (nodeData.ethernetPortCount ?? 0) ? 'ethernet' : 'optical';
        } else {
          // 汎用機器またはCSP機器の場合
          return nodeData.portType || getPortType(nodeData.modelName || nodeData.label) || 'ethernet';
        }
      };
      
      const sourcePortType = sourceNode ? getEdgePortType((sourceNode.data as any), edge.sourceHandle) : 'ethernet';
      const targetPortType = targetNode ? getEdgePortType((targetNode.data as any), edge.targetHandle) : 'ethernet';
      const isOpticalEdge = sourcePortType === 'optical' && targetPortType === 'optical';

      if (errorResult) {
        return {
          ...edge,
          style: { 
            ...edge.style, 
            stroke: '#f44336', 
            strokeWidth: edge.selected ? 4 : 2.5  // 選択時は太く
          },
          animated: true,
        };
      }

      if (warningResult) {
        return {
          ...edge,
          style: { 
            ...edge.style, 
            stroke: '#ff9800', 
            strokeWidth: edge.selected ? 3.5 : 2.5  // 選択時は太く
          },
        };
      }
      
      // 光ケーブルエッジのスタイル
      if (isOpticalEdge) {
        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: '#999',
            strokeWidth: edge.selected ? 3 : 2,
            filter: 'drop-shadow(0 0 3px #ffd900)'
          }
        };
      }

      // 通常エッジも選択時は太く
      if (edge.selected) {
        return {
          ...edge,
          style: {
            ...edge.style,
            strokeWidth: 3
          }
        };
      }

      return edge;
    });
  }, [edges, validationResult, nodes]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputField = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      
      // Ctrl+A / Cmd+A: 全選択
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !isInputField) {
        e.preventDefault();
        
        // 全ノードと全エッジを選択状態にする
        setNodes((nds: Node[]) => nds.map(n => ({ ...n, selected: true })));
        setEdges((eds: Edge[]) => eds.map(ed => ({ ...ed, selected: true })));
        return;
      }
      
      // Ctrl+C / Cmd+C: コピー
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isInputField) {
        const selectedNodes = (nodes as Node[]).filter(n => n.selected);
        if (selectedNodes.length === 0) return;
        
        e.preventDefault();
        
        // 選択されたノードに接続されているエッジもコピー
        const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
        const relatedEdges = (edges as Edge[]).filter(ed => 
          selectedNodeIds.has(ed.source) && selectedNodeIds.has(ed.target)
        );
        
        setClipboard({ nodes: selectedNodes, edges: relatedEdges, pasteCount: 0 });
        return;
      }
      
      // Ctrl+V / Cmd+V: ペースト
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isInputField) {
        if (!clipboard || clipboard.nodes.length === 0) return;
        
        // マスタ局が含まれているかチェック
        const hasMaster = clipboard.nodes.some(node => (node.data as any)?.isMaster === true);
        if (hasMaster) {
          e.preventDefault();
          setErrorMessage('マスタ局はコピー&ペーストできません。');
          return;
        }
        
        e.preventDefault();
        
        // 累積オフセット（ペーストのたびに30pxずつ増加）
        const offset = (clipboard.pasteCount + 1) * 30;
        
        // エッジがある場合は局番順にソート、ない場合はそのまま
        let sortedNodes = [...clipboard.nodes];
        if (clipboard.edges.length > 0) {
          // 元の局番でソート
          sortedNodes.sort((a, b) => {
            const aNum = (a.data as any)?.stationNumber ?? 999;
            const bNum = (b.data as any)?.stationNumber ?? 999;
            return aNum - bNum;
          });
        }
        
        // 既存の局番を取得（ペースト処理の外で一度だけ）
        const usedNumbers = (nodes as Node[])
          .map(n => (n.data as any)?.stationNumber)
          .filter((num): num is number => num != null && num > 0);
        
        // ノードIDの対応表（旧ID → 新ID）
        const idMap = new Map<string, string>();
        const newNodes: Node[] = [];
        
        sortedNodes.forEach(node => {
          const newId = nanoid(6);
          idMap.set(node.id, newId);
          
          const data = node.data as any;
          
          // マスタ局はローカル局に変換
          let stationType = data.stationType;
          let isMaster = false;
          if (stationType === 'master') {
            stationType = 'local';
          }
          
          // 局番を自動採番（スイッチ・Ethernet機器以外）
          let stationNumber: number | undefined;
          if (stationType === 'master' || stationType === 'local' || stationType === 'remote') {
            // 1～253の中で未使用の最小値を割り当て
            for (let i = 1; i <= 253; i++) {
              if (!usedNumbers.includes(i)) {
                stationNumber = i;
                usedNumbers.push(i); // 次のノード用に追加（重複防止）
                break;
              }
            }
          }
          
          const newNode: Node = {
            ...node,
            id: newId,
            position: {
              x: node.position.x + offset,
              y: node.position.y + offset
            },
            selected: true, // 新しいノードを選択状態に
            data: {
              ...data,
              isMaster,
              stationType,
              stationNumber
            }
          };
          
          newNodes.push(newNode);
        });
        
        // エッジもコピー（ノードIDを新しいものに置き換え）
        const newEdges: Edge[] = clipboard.edges.map(edge => ({
          ...edge,
          id: nanoid(8),
          source: idMap.get(edge.source) || edge.source,
          target: idMap.get(edge.target) || edge.target,
          selected: false
        }));
        
        // 既存の選択を解除して新しいノードを追加
        setNodes((nds: Node[]) => [
          ...nds.map(n => ({ ...n, selected: false })),
          ...newNodes
        ]);
        
        setEdges((eds: Edge[]) => [...eds, ...newEdges]);
        
        // ペーストカウントを増やす（次回のペースト位置用）
        setClipboard({ ...clipboard, pasteCount: clipboard.pasteCount + 1 });
        return;
      }
      
      // DeleteキーまたはBackspaceキーで削除
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isInputField) return;
      
      const selectedNodes = (nodes as Node[]).filter(n => n.selected);
      const selectedEdges = (edges as Edge[]).filter(ed => ed.selected);
      if (!selectedNodes.length && !selectedEdges.length) return;
      e.preventDefault();
      const nodeIds = new Set(selectedNodes.map(n => n.id));
      // エッジを削除: 選択されたエッジ + 選択されたノードに接続されているエッジ
      setEdges((eds: Edge[]) => eds.filter(ed => !selectedEdges.some(se => se.id === ed.id) && !nodeIds.has(ed.source) && !nodeIds.has(ed.target)));
      // ノードを削除
      if (selectedNodes.length) setNodes((nds: Node[]) => nds.filter(n => !nodeIds.has(n.id)));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [nodes, edges, setNodes, setEdges, clipboard]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <style>{`
        /* エッジ選択時のスタイルを太く強調 */
        .react-flow__edge.selected .react-flow__edge-path {
          stroke-width: 4px !important;
        }
      `}</style>
      <div
        style={{ flex: 1, position: 'relative' }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-csp-device') || 
              e.dataTransfer.types.includes('application/x-network-device') ||
              e.dataTransfer.types.includes('application/x-master-only-device') ||
              e.dataTransfer.types.includes('application/x-generic-device')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!rfInstance) return;
          
          // ドロップ時にパネルを閉じる
          setValidationPanelVisible(false);
          
          const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const pos = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
          const flowPos = rfInstance.project(pos);
          
          // CSPデバイスのドロップ処理
          const cspRaw = e.dataTransfer.getData('application/x-csp-device');
          if (cspRaw) {
            try {
              const dev: CspDeviceSummary = JSON.parse(cspRaw);
              addNode(flowPos, dev);
              return;
            } catch (err) {
              console.warn('Failed to parse dropped CSP device', err);
            }
          }
          
          // ネットワーク機器のドロップ処理
          const netRaw = e.dataTransfer.getData('application/x-network-device');
          if (netRaw) {
            try {
              const netDev: { id: string; label: string; stationType: string; image: string } = JSON.parse(netRaw);
              // ネットワーク機器用の疑似CspDeviceSummaryを作成してaddNodeに渡す
              const pseudoDev: CspDeviceSummary = {
                id: netDev.id,
                modelName: netDev.label,
                image: netDev.image, // imageプロパティをそのまま使用
                deviceTypeDetailNormalized: netDev.stationType // stationTypeを識別用に保持
              };
              addNode(flowPos, pseudoDev);
            } catch (err) {
              console.warn('Failed to parse dropped network device', err);
            }
          }
          
          // マスタ専用機器のドロップ処理
          const masterRaw = e.dataTransfer.getData('application/x-master-only-device');
          if (masterRaw) {
            try {
              const masterDev: { id: string; label: string; deviceTypeDetailNormalized: string; image: string } = JSON.parse(masterRaw);
              
              // 既存のマスタ局をチェック
              const currentMaster = (nodes as Node[]).find(n => (n.data as any)?.stationType === 'master');
              if (currentMaster) {
                // ポート種別チェック
                const currentMasterData = currentMaster.data as any;
                const oldPortType = currentMasterData.portType || getPortType(currentMasterData.modelName) || 'ethernet';
                const newPortType = getPortType(masterDev.label) || 'ethernet';
                
                // ポート種別変更情報を保存
                if (oldPortType !== newPortType) {
                  const affectedEdges = (edges as Edge[]).filter(e =>
                    e.source === currentMaster.id || e.target === currentMaster.id
                  );
                  
                  if (affectedEdges.length > 0) {
                    (window as any).__portTypeChanged = {
                      oldPortType,
                      newPortType,
                      affectedEdges
                    };
                  }
                }
                
                // ポート数減少チェック
                const oldPortCount = currentMasterData.portCount ?? 2;
                const deviceDefaults = getMasterDevice(masterDev.label || masterDev.id);
                const newPortCount = deviceDefaults?.defaultPortCount ?? 2;
                let affectedEdgesCount = 0;
                
                if (newPortCount < oldPortCount) {
                  const allEdges = (edges as Edge[]).filter(e =>
                    e.source === currentMaster.id || e.target === currentMaster.id
                  );
                  
                  affectedEdgesCount = allEdges.filter(edge => {
                    const handleId = edge.source === currentMaster.id ? edge.sourceHandle : edge.targetHandle;
                    if (!handleId) return false;
                    const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
                    return portNumber > newPortCount;
                  }).length;
                }
                
                // 入れ替え確認用のstateを設定（ドロップ位置も保存）
                (window as any).__pendingMasterDeviceDrop = { masterDev, flowPos };
                setPromoteToMasterConfirm({
                  nodeId: 'drop-pending',
                  currentMasterId: currentMaster.id,
                  replaceMode: 'delete',
                  affectedEdgesCount: affectedEdgesCount > 0 ? affectedEdgesCount : undefined
                });
                return;
              }
              
              const pseudoDev: CspDeviceSummary = {
                id: masterDev.id,
                modelName: masterDev.label,
                image: masterDev.image,
                deviceTypeDetailNormalized: masterDev.deviceTypeDetailNormalized
              };
              addNode(flowPos, pseudoDev);
            } catch (err: any) {
              console.warn('Failed to add master-only device', err);
              // エラーメッセージを表示
              setErrorMessage(err?.message || 'マスタ局専用機器の追加に失敗しました');
            }
          }

          // 汎用機器のドロップ処理
          const genericRaw = e.dataTransfer.getData('application/x-generic-device');
          if (genericRaw) {
            try {
              const genDev: { id: string; label: string; stationType: 'master' | 'local' | 'remote'; deviceClass: 'A' | 'B'; speed: '100M' | '1G'; ports: number; image: string } = JSON.parse(genericRaw);
              
              // マスタ局の場合は既存マスタをチェック
              if (genDev.stationType === 'master') {
                const currentMaster = (nodes as Node[]).find(n => (n.data as any)?.stationType === 'master');
                if (currentMaster) {
                  // ポート種別チェック（汎用機器は常にethernetなので、旧マスタがopticalの場合のみ警告）
                  const currentMasterData = currentMaster.data as any;
                  const oldPortType = currentMasterData.portType || getPortType(currentMasterData.modelName) || 'ethernet';
                  const newPortType = 'ethernet'; // 汎用機器は常にethernet
                  
                  // ポート種別変更情報を保存
                  if (oldPortType !== newPortType) {
                    const affectedEdges = (edges as Edge[]).filter(e =>
                      e.source === currentMaster.id || e.target === currentMaster.id
                    );
                    
                    if (affectedEdges.length > 0) {
                      (window as any).__portTypeChanged = {
                        oldPortType,
                        newPortType,
                        affectedEdges
                      };
                    }
                  }
                  
                  // ポート数減少チェック
                  const oldPortCount = currentMasterData.portCount ?? 2;
                  const newPortCount = genDev.ports || 2;
                  let affectedEdgesCount = 0;
                  
                  if (newPortCount < oldPortCount) {
                    const allEdges = (edges as Edge[]).filter(e =>
                      e.source === currentMaster.id || e.target === currentMaster.id
                    );
                    
                    affectedEdgesCount = allEdges.filter(edge => {
                      const handleId = edge.source === currentMaster.id ? edge.sourceHandle : edge.targetHandle;
                      if (!handleId) return false;
                      const portNumber = parseInt(handleId.replace(/^port(\d+)_(in|out)$/, '$1'));
                      return portNumber > newPortCount;
                    }).length;
                  }
                  
                  // 一時的にドロップ情報を保存
                  (window as any).__pendingGenericDeviceDrop = { genDev, flowPos };
                  setPromoteToMasterConfirm({
                    nodeId: 'drop-pending',
                    currentMasterId: currentMaster.id,
                    replaceMode: 'delete',
                    affectedEdgesCount: affectedEdgesCount > 0 ? affectedEdgesCount : undefined
                  });
                  return;
                }
              }
              
              // 汎用機器用の疑似CspDeviceSummaryを作成
              const canChangeClass = genDev.stationType === 'remote';
              const pseudoDev: CspDeviceSummary = {
                id: genDev.id,
                modelName: genDev.label, // 汎用機器は label にした（"汎用マスタ局"など）
                image: genDev.image,
                stationType: genDev.stationType, // 汎用機器の場合、stationType を明示的に設定
                // deviceTypeDetailNormalized を設定しない！ flowStore で汎用判定は modelName で行う
                classDefault: genDev.deviceClass,
                classOptions: canChangeClass ? ['A', 'B'] : undefined,
                speedOptions: ['100M', '1G']
              };
              addNode(flowPos, pseudoDev);
            } catch (err: any) {
              console.warn('Failed to add generic device', err);
              setErrorMessage(err?.message || '汎用機器の追加に失敗しました');
            }
          }
        }}
      >
        <RF
          key={`rf-${nodes.map((n: Node) => `${n.id}-${(n.data as any)?.portCount ?? 2}`).join('_')}`}
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={(e: any, params: any) => { setIsConnecting(true); setConnectingSourceNodeId(params?.nodeId || null); }}
          onConnectEnd={() => { setIsConnecting(false); setConnectingSourceNodeId(null); }}
          onNodeDragStart={startNodeDrag}
          onNodeDragStop={finalizeNodeDrag}
          nodeTypes={nodeTypes}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setValidationPanelVisible(false)}
          defaultEdgeOptions={{ 
            style: { strokeWidth: 2, stroke: '#555', strokeLinecap: 'round' }
          }}
          connectionRadius={24}
          fitView
          onInit={setRfInstance}
          zoomOnScroll={true}          // 通常ホイールはキャンバスズーム許可
          zoomOnPinch={true}
          panOnScroll={true}
          // ctrl+wheel だけはブラウザ標準ズームへ委譲するためキャンバス側で無視
          onWheel={(e) => {
            if (e.ctrlKey) {
              // React Flow のズーム抑止: 何もせずイベントを上層へ (ブラウザがページズーム)
              // react-flow が内部で preventDefault する前に止めたいのでここで早期 return
              // 注意: この onWheel はバブル段階。react-flow 本体が ctrlKey を検出してズームしない仕様の場合でも互換維持。
              return; // allow default
            }
            // 非 ctrlKey (通常) の場合は react-flow に任せる (内部 zoomOnScroll=true)
          }}
        >
          <Background />
          <MiniMap />
          <Controls />
          
          {/* ウェルカムメッセージ: ノードが0個の時だけ表示 */}
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(255, 255, 255, 0.95)',
              border: '2px solid #1976d2',
              borderRadius: 12,
              padding: '32px 48px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              textAlign: 'center',
              maxWidth: 500,
              zIndex: 10,
              pointerEvents: 'none'
            }}>
              <Typography variant="h5" sx={{ fontWeight: 600, color: '#1976d2', mb: 2 }}>
                CC-Link IE TSN 構成チェックツール
              </Typography>
              <Typography variant="body1" sx={{ mb: 1, textAlign: 'left', lineHeight: 1.8 }}>
                <strong>1.</strong> 右側の機器リストから機器をドラッグ＆ドロップ<br/>
                <strong>2.</strong> ポート（◯）をドラッグして機器間を接続<br/>
                <strong>3.</strong> 構成チェックボタンで接続可否を確認
              </Typography>
            </div>
          )}
          
          <Panel position="top-right">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* 通信モード切り替え */}
              <select 
                value={communicationMode} 
                onFocus={() => setValidationPanelVisible(false)}
                onChange={(e) => {
                  setCommunicationMode(e.target.value as 'unicast' | 'multicast');
                }}
                style={{ 
                  padding: '6px 12px', 
                  borderRadius: 4, 
                  border: '1px solid #ccc',
                  fontSize: '13px',
                  cursor: 'pointer',
                  backgroundColor: 'white'
                }}
              >
                <option value="unicast">📡 ユニキャスト</option>
                <option value="multicast">📡 マルチキャスト</option>
              </select>
              
              <span style={{ color: '#ccc' }}>|</span>
              
              <button 
                onClick={executeAutoLayout} 
                style={{ 
                  background: '#388E3C', 
                  color: 'white', 
                  border: 'none', 
                  padding: '6px 12px', 
                  borderRadius: 4, 
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                自動配列 ({(() => {
                  const topology = detectTopology(nodes as Node[], edges as Edge[]);
                  const labels = { LINE: 'ライン', STAR: 'スター', RING: 'リング', MIXED: '混在' };
                  return labels[topology];
                })()})
              </button>
              <button onClick={() => setAutoWiringConfirm(true)}>自動配線</button>
              <button onClick={executeValidation} style={{ fontWeight: 'bold', background: '#1976d2', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}>構成チェック</button>
            </div>
          </Panel>
          <Menu
            open={contextMenu !== null}
            onClose={closeMenu}
            anchorReference="anchorPosition"
            anchorPosition={contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
          >
            {(() => {
              if (!contextMenu) return null;
              
              // エッジ用のコンテキストメニュー
              if (contextMenu.edgeId) {
                return (
                  <MenuItem
                    onClick={() => {
                      setEdges((eds: Edge[]) => eds.filter(e => e.id !== contextMenu.edgeId));
                      closeMenu();
                      setValidationPanelVisible(false);
                    }}
                  >
                    削除
                  </MenuItem>
                );
              }
              
              // ノード用のコンテキストメニュー
              // マスタ局設定メニューは「マスタ・ローカルユニット」分類の機器のみに表示
              // ただし、既にマスタ局の場合は表示しない
              const node = (nodes as Node[]).find(n => n.id === contextMenu.nodeId);
              if (!node) return null;
              const nodeData = node.data as any;
              const canBeMaster = canBeMasterOrLocal(nodeData?.deviceTypeDetailNormalized);
              const isAlreadyMaster = nodeData?.stationType === 'master';
              
              return (
                <>
                  {canBeMaster && !isAlreadyMaster && (
                    <>
                      <Typography variant="caption" sx={{ px: 2, pt: 1, opacity: 0.7 }}>マスタ局</Typography>
                      <MenuItem onClick={() => {
                        if (contextMenu && contextMenu.nodeId) {
                          const nodeId = contextMenu.nodeId;
                          
                          // 既存のマスタ局を検索（マスタ局専用機器を含む）
                          const currentMaster = (nodes as Node[]).find(n => (n.data as any)?.stationType === 'master');
                          
                          if (currentMaster && currentMaster.id !== nodeId) {
                            // マスタ局が存在する場合は確認ダイアログを表示
                            // 旧マスタがマスタ局専用機器の場合は削除モード、それ以外は降格モード
                            const currentMasterData = currentMaster.data as any;
                            const isCurrentMasterOnly = currentMasterData?.deviceTypeDetailNormalized === 'マスタ局専用ユニット';
                            
                            setPromoteToMasterConfirm({ 
                              nodeId, 
                              currentMasterId: currentMaster.id,
                              replaceMode: isCurrentMasterOnly ? 'delete' : 'demote'
                            });
                            closeMenu();
                          } else {
                            // マスタ局が存在しない場合は即座に変更
                            setNodes((nds: Node[]) => {
                              return nds.map(n => {
                                if (n.id === nodeId) {
                                  const modelName = (n.data as any)?.label;
                                  const maxStations = modelName ? getMaxStations(modelName) : undefined;
                                  return {
                                    ...n,
                                    data: {
                                      ...(n.data as any),
                                      isMaster: true,
                                      stationType: 'master',
                                      stationNumber: 0,
                                      maxStations
                                    }
                                  };
                                }
                                return n;
                              });
                            });
                            closeMenu();
                          }
                        }
                      }}>マスタ局に設定する</MenuItem>
                      <Divider />
                    </>
                  )}
                  <MenuItem onClick={() => {
                    if (contextMenu && contextMenu.nodeId) {
                      setParameterDialog({ nodeId: contextMenu.nodeId });
                      closeMenu();
                    }
                  }}>パラメータ設定...</MenuItem>
                  {(() => {
                    // マスタ専用機器（MXコントローラ・モーションユニット）の場合は複製メニューを非表示
                    const node = (nodes as Node[]).find(n => n.id === contextMenu?.nodeId);
                    const deviceTypeDetail = (node?.data as any)?.deviceTypeDetailNormalized;
                    const isMasterOnly = deviceTypeDetail === 'マスタ局専用ユニット';
                    
                    if (isMasterOnly) {
                      return null;
                    }
                    
                    return (
                      <MenuItem onClick={() => {
                        if (contextMenu && contextMenu.nodeId) {
                          setDuplicateDialog({ nodeId: contextMenu.nodeId, count: 0 });
                          closeMenu();
                        }
                      }}>複製（数量指定）...</MenuItem>
                    );
                  })()}
                  <MenuItem onClick={() => {
                    if (contextMenu && contextMenu.nodeId) {
                      const nodeToDelete = contextMenu.nodeId;
                      setNodes((nds: Node[]) => nds.filter(n => n.id !== nodeToDelete));
                      setEdges((eds: Edge[]) => eds.filter(e => e.source !== nodeToDelete && e.target !== nodeToDelete));
                      closeMenu();
                    }
                  }}>削除</MenuItem>
                </>
              );
            })()}
          </Menu>
          <Dialog open={!!renameTarget} onClose={cancelRename} maxWidth="xs" fullWidth>
            <DialogTitle>ノード名称を編集</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                margin="dense"
                label="名称 (形名)"
                fullWidth
                size="small"
                value={renameTarget?.value ?? ''}
                onChange={(e) => setRenameTarget(rt => rt ? { ...rt, value: e.target.value } : rt)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(); } }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={cancelRename}>キャンセル</Button>
              <Button onClick={saveRename} disabled={!renameTarget?.value?.trim()} variant="contained">保存</Button>
            </DialogActions>
          </Dialog>
          <StationNumberDialog
            open={!!stationNumberDialog}
            currentNumber={stationNumberDialog?.currentNumber ?? 0}
            nodeId={stationNumberDialog?.nodeId ?? ''}
            nodes={nodes as Node[]}
            onClose={() => setStationNumberDialog(null)}
            onSave={handleChangeStationNumber}
          />
          {/* ポート種別変更確認ダイアログ */}
          <Dialog open={!!portTypeChangeConfirm} onClose={() => setPortTypeChangeConfirm(null)}>
            <DialogTitle>接続の削除確認</DialogTitle>
            <DialogContent>
              <Typography>
                ポート種別が変更されるため、選択した機器に接続されている{portTypeChangeConfirm?.affectedEdges.length ?? 0}本のエッジが削除されます。
              </Typography>
              <Typography sx={{ mt: 1, color: 'warning.main' }}>
                この操作は元に戻せません。続行しますか？
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPortTypeChangeConfirm(null)}>キャンセル</Button>
              <Button 
                onClick={() => {
                  if (!portTypeChangeConfirm) return;
                  
                  const { selectedNodes, newDevice, affectedEdges, isNetworkDevice } = portTypeChangeConfirm;
                  const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
                  
                  // エッジを削除
                  setEdges((eds: Edge[]) => eds.filter(e => !affectedEdges.some(ae => ae.id === e.id)));
                  
                  // 機器を変更
                  if (isNetworkDevice) {
                    // ネットワーク機器の場合
                    setNodes((nds: Node[]) => nds.map(n => selectedNodeIds.has(n.id) ? {
                      ...n,
                      data: {
                        label: newDevice.label,
                        imageUrl: undefined,
                        deviceClass: undefined,
                        deviceClassOptions: undefined,
                        speed: undefined,
                        deviceSpeedOptions: undefined,
                        isMaster: false,
                        stationType: newDevice.stationType,
                        stationNumber: undefined,
                        deviceTypeDetailNormalized: undefined,
                        portCount: getDefaultPortCount(newDevice.stationType),
                        portType: 'ethernet'
                      }
                    } : n));
                  } else {
                    // TSN機器の場合
                    const baseUrl = (import.meta as any).env?.BASE_URL ?? './';
                    const url = baseUrl + newDevice.image;
                    const initialClass = newDevice.classDefault || newDevice.class || 'A';
                    let initialSpeed: '100M' | '1G' = '1G';
                    if (newDevice.speedOptions && newDevice.speedOptions.length) {
                      if (newDevice.speedOptions.includes('1G')) initialSpeed = '1G';
                      if (!newDevice.speedOptions.includes('1G') && newDevice.speedOptions.includes('100M')) initialSpeed = '100M';
                      if (newDevice.speedOptions.length === 1) initialSpeed = newDevice.speedOptions[0];
                    }
                    const stationType = canBeMasterOrLocal(newDevice.deviceTypeDetailNormalized) ? 'local' : 'remote';
                    const usedNumbers = getUsedStationNumbers((nodes as Node[]).filter(n => !selectedNodeIds.has(n.id)));
                    
                    setNodes((nds: Node[]) => {
                      return nds.map(n => {
                        if (!selectedNodeIds.has(n.id)) return n;
                        
                        const currentData = n.data as any;
                        const wasMaster = currentData.isMaster;
                        const canBeMaster = canBeMasterOrLocal(newDevice.deviceTypeDetailNormalized);
                        const willBeMaster = canBeMaster && wasMaster;
                        
                        let newStationNumber: number | undefined;
                        if (willBeMaster) {
                          newStationNumber = 0;
                        } else {
                          newStationNumber = allocateStationNumber(usedNumbers);
                          if (newStationNumber !== undefined) {
                            usedNumbers.push(newStationNumber);
                          }
                        }
                        
                        return {
                          ...n,
                          data: {
                            label: newDevice.modelName,
                            modelName: newDevice.modelName,
                            imageUrl: url,
                            deviceClass: initialClass,
                            deviceClassOptions: newDevice.classOptions,
                            speed: initialSpeed,
                            deviceSpeedOptions: newDevice.speedOptions,
                            isMaster: willBeMaster,
                            stationType: willBeMaster ? 'master' : stationType,
                            stationNumber: newStationNumber,
                            deviceTypeDetailNormalized: newDevice.deviceTypeDetailNormalized,
                            portCount: getDefaultPortCount(newDevice.modelName),
                            portType: getPortType(newDevice.modelName)
                          }
                        };
                      });
                    });
                  }
                  
                  setPortTypeChangeConfirm(null);
                  
                  // マスタ入れ替えが待機中の場合は、入れ替えダイアログを表示
                  const pendingMasterReplaceId = (window as any).__pendingMasterReplaceId;
                  if (pendingMasterReplaceId) {
                    const pendingMasterDrop = (window as any).__pendingMasterDeviceDrop;
                    const pendingGenericDrop = (window as any).__pendingGenericDeviceDrop;
                    
                    if (pendingMasterDrop || pendingGenericDrop) {
                      setPromoteToMasterConfirm({
                        nodeId: 'drop-pending',
                        currentMasterId: pendingMasterReplaceId,
                        replaceMode: 'delete'
                      });
                      delete (window as any).__pendingMasterReplaceId;
                    }
                  }
                }}
                color="warning"
                variant="contained"
              >
                削除して続行
              </Button>
            </DialogActions>
          </Dialog>
          {parameterDialog && (() => {
            const node = (nodes as Node[]).find(n => n.id === parameterDialog.nodeId);
            if (!node) return null;
            const nodeData = node.data as any;
            const isGenericMaster = nodeData.modelName === 'generic-master' || 
                                   (nodeData.stationType === 'master' && nodeData.label === '汎用マスタ局');
            return (
              <ParameterDialog
                open={true}
                nodeId={parameterDialog.nodeId}
                nodeLabel={nodeData.label || 'ノード'}
                stationType={nodeData.stationType || 'remote'}
                currentData={{
                  portCount: nodeData.portCount,
                  maxStations: nodeData.maxStations,
                  firmwareVersion: nodeData.firmwareVersion,
                  protocolVersion: nodeData.protocolVersion,
                  cyclicDataBytes: nodeData.cyclicDataBytes,
                  supportsMulticastFilter: nodeData.supportsMulticastFilter,
                  isRingCapable: nodeData.isRingCapable,
                  portsUsed: nodeData.portsUsed,
                  hardwareVersion: nodeData.hardwareVersion,
                  cycleSetting: nodeData.cycleSetting,
                  forbiddenPortsConfigured: nodeData.forbiddenPortsConfigured,
                  isGenericMaster,
                  modelName: nodeData.modelName,
                  portType: nodeData.portType,
                  opticalPortCount: nodeData.opticalPortCount,
                  ethernetPortCount: nodeData.ethernetPortCount,
                  supportsOpticalPorts: nodeData.supportsOpticalPorts,
                  defaultPortType: nodeData.defaultPortType
                }}
                onClose={() => setParameterDialog(null)}
                onSave={handleSaveParameters}
              />
            );
          })()}
        </RF>
      </div>
      <div style={{ pointerEvents: isConnecting ? 'none' : 'auto' }}>
        <DevicePalette 
          onBulkAdd={handleBulkAdd}
          hasMasterSelected={nodes.some((n: Node) => n.selected && (n.data as any)?.isMaster)}
          onHoverChange={(hover: boolean) => {
          // 追加オプション: ホバー中は ReactFlow 側のズーム/パンを無効化
          // 最小侵襲: rfInstance の内部オプションを切り替え (一部バージョンで再レンダ不要)
          if (!rfInstance) return;
          try {
            (rfInstance as any).setState?.( (s: any) => ({ ...s, panOnScroll: !hover, zoomOnScroll: !hover }) );
          } catch {
            // フォールバック: 何もしない
          }
        }}
          onAccordionChange={() => {
            // アコーディオンを開閉したときに検証パネルを閉じる
            setValidationPanelVisible(false);
          }} />
        {isConnecting && (
          <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 10, background: '#ffc', padding: '2px 6px', border: '1px solid #dda', borderRadius: 4, pointerEvents: 'none', opacity: 0.9 }}>
            接続操作中: 他のクリックは一時的に無効
          </div>
        )}
        {/* 検証パネル */}
        {validationPanelVisible && (
          <ValidationPanel 
            validationResult={validationResult} 
            onClose={() => setValidationPanelVisible(false)} 
          />
        )}
        {/* 自動配線確認ダイアログ */}
        <Dialog open={autoWiringConfirm} onClose={() => setAutoWiringConfirm(false)} maxWidth="sm" fullWidth>
          <DialogTitle>自動配線の確認</DialogTitle>
          <DialogContent>
            <Typography>
              局番順にライン接続を行います。既存の接続はすべて削除されますがよろしいですか？
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAutoWiringConfirm(false)}>キャンセル</Button>
            <Button onClick={executeAutoWiring} variant="contained" color="primary">実行</Button>
          </DialogActions>
        </Dialog>
        {/* マスタ局入れ替え確認ダイアログ */}
        <Dialog open={!!promoteToMasterConfirm} onClose={() => {
          setPromoteToMasterConfirm(null);
          delete (window as any).__portTypeChanged;
        }} maxWidth="sm" fullWidth>
          <DialogTitle>マスタ局の入れ替え</DialogTitle>
          <DialogContent>
            {(() => {
              if (!promoteToMasterConfirm) return null;
              const currentMaster = (nodes as Node[]).find(n => n.id === promoteToMasterConfirm.currentMasterId);
              const currentMasterLabel = (currentMaster?.data as any)?.label || 'マスタ局';
              
              // 追加ボタンからの場合は待機中のデータからラベルを取得
              let targetLabel = 'このノード';
              if (promoteToMasterConfirm.nodeId === 'bulk-add-pending') {
                const pendingMasterBulkAdd = (window as any).__pendingMasterBulkAdd;
                const pendingGenericBulkAdd = (window as any).__pendingGenericBulkAdd;
                if (pendingMasterBulkAdd) {
                  targetLabel = pendingMasterBulkAdd.masterDev.label || pendingMasterBulkAdd.masterDev.id;
                } else if (pendingGenericBulkAdd) {
                  targetLabel = pendingGenericBulkAdd.genDev.label;
                }
              } else if (promoteToMasterConfirm.nodeId === 'drop-pending') {
                // ドロップからの場合も待機中のデータからラベルを取得
                const pendingMasterDeviceDrop = (window as any).__pendingMasterDeviceDrop;
                const pendingGenericDeviceDrop = (window as any).__pendingGenericDeviceDrop;
                if (pendingMasterDeviceDrop) {
                  targetLabel = pendingMasterDeviceDrop.masterDev.label;
                } else if (pendingGenericDeviceDrop) {
                  targetLabel = pendingGenericDeviceDrop.genDev.label;
                }
              } else {
                const targetNode = (nodes as Node[]).find(n => n.id === promoteToMasterConfirm.nodeId);
                targetLabel = (targetNode?.data as any)?.label || 'このノード';
              }
              
              const portTypeChangedInfo = (window as any).__portTypeChanged;
              const affectedEdgesCount = promoteToMasterConfirm.affectedEdgesCount;
              
              if (promoteToMasterConfirm.replaceMode === 'delete') {
                return (
                  <>
                    <Typography>
                      マスタ局の{currentMasterLabel}を削除して、{targetLabel}をマスタ局にしますか？
                    </Typography>
                    {affectedEdgesCount !== undefined && affectedEdgesCount > 0 && (
                      <Typography color="warning.main" sx={{ mt: 2, fontWeight: 'bold' }}>
                        ⚠ ポート数が減少するため、{affectedEdgesCount}件の接続が削除されます。
                      </Typography>
                    )}
                    {portTypeChangedInfo && (
                      <Typography color="warning.main" sx={{ mt: 2, fontWeight: 'bold' }}>
                        ⚠ ポート種別が異なります（{portTypeChangedInfo.oldPortType === 'optical' ? '光ケーブル' : 'イーサネット'}→{portTypeChangedInfo.newPortType === 'optical' ? '光ケーブル' : 'イーサネット'}）。
                        既存の接続 {portTypeChangedInfo.affectedEdges.length} 本が削除されます。
                      </Typography>
                    )}
                  </>
                );
              } else {
                return (
                  <>
                    <Typography>
                      マスタ局の{currentMasterLabel}をローカル局に変更して、{targetLabel}をマスタ局にしますか？
                    </Typography>
                    {affectedEdgesCount !== undefined && affectedEdgesCount > 0 && (
                      <Typography color="warning.main" sx={{ mt: 2, fontWeight: 'bold' }}>
                        ⚠ ポート数が減少するため、{affectedEdgesCount}件の接続が削除されます。
                      </Typography>
                    )}
                    {portTypeChangedInfo && (
                      <Typography color="warning.main" sx={{ mt: 2, fontWeight: 'bold' }}>
                        ⚠ ポート種別が異なります（{portTypeChangedInfo.oldPortType === 'optical' ? '光ケーブル' : 'イーサネット'}→{portTypeChangedInfo.newPortType === 'optical' ? '光ケーブル' : 'イーサネット'}）。
                        既存の接続 {portTypeChangedInfo.affectedEdges.length} 本が削除されます。
                      </Typography>
                    )}
                  </>
                );
              }
            })()}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setPromoteToMasterConfirm(null);
              delete (window as any).__portTypeChanged;
            }}>キャンセル</Button>
            <Button onClick={executePromoteToMaster} variant="contained" color="primary">入れ替える</Button>
          </DialogActions>
        </Dialog>
        {/* 複製（数量指定）ダイアログ */}
        <Dialog open={!!duplicateDialog} onClose={() => setDuplicateDialog(null)} maxWidth="xs" fullWidth>
          <DialogTitle>複製（数量指定）</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="複製数量"
              type="number"
              fullWidth
              size="small"
              placeholder="10"
              value={duplicateDialog?.count || ''}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : Math.max(1, Math.min(100, parseInt(e.target.value) || 10));
                setDuplicateDialog(d => d ? { ...d, count: val } : null);
              }}
              inputProps={{ min: 1, max: 100 }}
            />
            <Typography variant="caption" sx={{ mt: 1, display: 'block', opacity: 0.7 }}>
              選択したノードを指定数量分複製します（格子状に配置）
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDuplicateDialog(null)}>キャンセル</Button>
            <Button onClick={executeDuplicate} variant="contained" color="primary" disabled={!duplicateDialog?.count}>複製</Button>
          </DialogActions>
        </Dialog>
        {/* 汎用確認ダイアログ */}
        <Dialog open={!!confirmDialog} onClose={() => confirmDialog?.onCancel()} maxWidth="sm" fullWidth>
          <DialogTitle>{confirmDialog?.title}</DialogTitle>
          <DialogContent>
            <Typography>{confirmDialog?.message}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => confirmDialog?.onCancel()}>キャンセル</Button>
            <Button onClick={() => confirmDialog?.onConfirm()} variant="contained" color="primary">OK</Button>
          </DialogActions>
        </Dialog>
        {/* エラーメッセージ表示 */}
        <Snackbar
          open={!!errorMessage}
          autoHideDuration={6000}
          onClose={() => setErrorMessage(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={() => setErrorMessage(null)} severity="error" sx={{ width: '100%' }}>
            {errorMessage}
          </Alert>
        </Snackbar>
      </div>
    </div>
  );
}
