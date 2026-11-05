// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Radio,
  RadioGroup,
  Typography,
  Box
} from '@mui/material';
import { isPortCountEditable, getPortCountRange, getOpticalPortInfo } from '../utils/portCountDict';

interface ParameterDialogProps {
  open: boolean;
  nodeId: string;
  nodeLabel: string;
  stationType: 'master' | 'local' | 'remote' | 'switch-classB' | 'switch-classA' | 'switch-general' | 'ethernet-device';
  currentData: {
    portCount?: number;
    maxStations?: number;
    firmwareVersion?: number | string;
    protocolVersion?: '1.0' | '2.0';
    cyclicDataBytes?: number;
    supportsMulticastFilter?: boolean;
    isRingCapable?: boolean;
    portsUsed?: 'single' | 'both';
    hardwareVersion?: number | string;
    cycleSetting?: 'LOW' | 'BASIC' | 'MID';
    forbiddenPortsConfigured?: Set<string>;
    isGenericMaster?: boolean; // 汎用マスタ局かどうか
    modelName?: string; // 機器の形名（CSPデバイスの場合）
    portType?: 'ethernet' | 'optical'; // ポート種別（汎用機器用）
    opticalPortCount?: number; // 光ポート数（スイッチ用）
    ethernetPortCount?: number; // イーサネットポート数（スイッチ用）
    supportsOpticalPorts?: boolean; // 光ケーブル対応フラグ
    defaultPortType?: 'ethernet' | 'optical'; // デフォルトポート種別
  };
  onClose: () => void;
  onSave: (params: any) => void;
}

export function ParameterDialog({
  open,
  nodeId,
  nodeLabel,
  stationType,
  currentData,
  onClose,
  onSave
}: ParameterDialogProps) {
  const [portCount, setPortCount] = useState<number>(currentData.portCount ?? 2);
  const [maxStations, setMaxStations] = useState<number | ''>(currentData.maxStations ?? '');
  const [firmwareVersion, setFirmwareVersion] = useState<number | string | ''>(currentData.firmwareVersion ?? '');
  const [protocolVersion, setProtocolVersion] = useState<'1.0' | '2.0' | ''>( currentData.protocolVersion ?? '');
  const [cyclicDataBytes, setCyclicDataBytes] = useState<number | ''>(currentData.cyclicDataBytes ?? '');
  const [supportsMulticastFilter, setSupportsMulticastFilter] = useState<'対応' | '非対応' | '未設定'>(
    currentData.supportsMulticastFilter === true ? '対応' : currentData.supportsMulticastFilter === false ? '非対応' : '未設定'
  );
  const [isRingCapable, setIsRingCapable] = useState<'対応' | '非対応' | '未設定'>(
    currentData.isRingCapable === true ? '対応' : currentData.isRingCapable === false ? '非対応' : '未設定'
  );
  const [portsUsed, setPortsUsed] = useState<'single' | 'both' | ''>(currentData.portsUsed ?? '');
  const [hardwareVersion, setHardwareVersion] = useState<number | string | ''>(currentData.hardwareVersion ?? '');
  const [cycleSetting, setCycleSetting] = useState<'LOW' | 'BASIC' | 'MID' | ''>( currentData.cycleSetting ?? '');
  const [forbiddenPorts, setForbiddenPorts] = useState<Set<string>>(currentData.forbiddenPortsConfigured ?? new Set());
  const [portType, setPortType] = useState<'ethernet' | 'optical'>(currentData.portType ?? 'ethernet');
  const [opticalPortCount, setOpticalPortCount] = useState<number>(currentData.opticalPortCount ?? 0);
  const [ethernetPortCount, setEthernetPortCount] = useState<number>(
    currentData.ethernetPortCount ?? ((currentData.portCount ?? 2) - (currentData.opticalPortCount ?? 0))
  );

  // currentDataが変更されたら状態を更新
  useEffect(() => {
    setPortCount(currentData.portCount ?? 2);
    setMaxStations(currentData.maxStations ?? '');
    setFirmwareVersion(currentData.firmwareVersion ?? '');
    setProtocolVersion(currentData.protocolVersion ?? '');
    setCyclicDataBytes(currentData.cyclicDataBytes ?? '');
    setSupportsMulticastFilter(
      currentData.supportsMulticastFilter === true ? '対応' : currentData.supportsMulticastFilter === false ? '非対応' : '未設定'
    );
    setIsRingCapable(
      currentData.isRingCapable === true ? '対応' : currentData.isRingCapable === false ? '非対応' : '未設定'
    );
    setPortsUsed(currentData.portsUsed ?? '');
    setHardwareVersion(currentData.hardwareVersion ?? '');
    setCycleSetting(currentData.cycleSetting ?? '');
    setForbiddenPorts(currentData.forbiddenPortsConfigured ?? new Set());
    setPortType(currentData.portType ?? 'ethernet');
    // 保存済みの値がある場合はそれを使用、ない場合はデフォルト（全てイーサネット）
    const savedOptical = currentData.opticalPortCount ?? 0;
    const savedEthernet = currentData.ethernetPortCount ?? ((currentData.portCount ?? 2) - savedOptical);
    setOpticalPortCount(savedOptical);
    setEthernetPortCount(savedEthernet);
  }, [currentData, open]);

  const handleSave = () => {
    const params: any = {
      portCount: Math.max(portRange.min, Math.min(portRange.max, portCount))
    };

    // マスタ局のパラメータ
    if (stationType === 'master') {
      if (currentData.isGenericMaster && maxStations !== '') {
        params.maxStations = Number(maxStations);
      }
      // 未設定の場合は null を明示的に設定
      params.firmwareVersion = firmwareVersion !== '' ? firmwareVersion : null;
      params.protocolVersion = protocolVersion !== '' ? protocolVersion : null;
      params.hardwareVersion = hardwareVersion !== '' ? hardwareVersion : null;
      params.supportsMulticastFilter = supportsMulticastFilter !== '未設定' ? (supportsMulticastFilter === '対応') : null;
      params.isRingCapable = isRingCapable !== '未設定' ? (isRingCapable === '対応') : null;
    }

    // ローカル局・リモート局のパラメータ
    if (stationType === 'local' || stationType === 'remote') {
      // 未設定の場合は null を明示的に設定
      params.firmwareVersion = firmwareVersion !== '' ? firmwareVersion : null;
      params.protocolVersion = protocolVersion !== '' ? protocolVersion : null;
      params.cycleSetting = cycleSetting !== '' ? cycleSetting : null;
      params.cyclicDataBytes = cyclicDataBytes !== '' ? Number(cyclicDataBytes) : null;
      params.hardwareVersion = hardwareVersion !== '' ? hardwareVersion : null;
      params.supportsMulticastFilter = supportsMulticastFilter !== '未設定' ? (supportsMulticastFilter === '対応') : null;
      params.isRingCapable = isRingCapable !== '未設定' ? (isRingCapable === '対応') : null;
    }

    // スイッチのパラメータ
    if (stationType.startsWith('switch-')) {
      params.forbiddenPortsConfigured = forbiddenPorts;
      params.opticalPortCount = opticalPortCount;
      params.ethernetPortCount = ethernetPortCount;
    }

    // ポート種別を保存（汎用機器 または defaultPortType が ethernet で supportsOpticalPorts が true の場合）
    if (isGenericDevice || (currentData.defaultPortType === 'ethernet' && currentData.supportsOpticalPorts === true)) {
      params.portType = portType;
    }

    onSave(params);
    onClose();
  };

  const handleForbiddenPortToggle = (port: string) => {
    const newSet = new Set(forbiddenPorts);
    if (newSet.has(port)) {
      newSet.delete(port);
    } else {
      newSet.add(port);
    }
    setForbiddenPorts(newSet);
  };

  const isMaster = stationType === 'master';
  const isLocalOrRemote = stationType === 'local' || stationType === 'remote';
  const isSwitch = stationType.startsWith('switch-');
  const isEthernet = stationType === 'ethernet-device';

  // ポート数の変更可否を判定
  // ネットワーク機器はstationTypeで判定、汎用機器はgeneric-{stationType}、TSN機器はmodelNameで判定
  const isNetworkDevice = stationType.startsWith('switch-') || stationType === 'ethernet-device';
  const isGenericDevice = nodeLabel.includes('汎用');
  
  let deviceId: string;
  if (isNetworkDevice) {
    deviceId = stationType;
  } else if (isGenericDevice) {
    deviceId = `generic-${stationType}`;
  } else {
    deviceId = currentData.modelName || stationType;
  }
  
  const portEditable = isPortCountEditable(deviceId);
  const portRange = getPortCountRange(deviceId);

  // デバッグ用ログ
  console.log('ParameterDialog - deviceId:', deviceId, 'portEditable:', portEditable, 'isGenericDevice:', isGenericDevice, 'nodeLabel:', nodeLabel, 'stationType:', stationType);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>パラメータ設定 - {nodeLabel}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {/* ポート数（変更可能な機器のみ表示） */}
          {portEditable && (
            <TextField
              label="ポート数"
              type="number"
              value={portCount}
              onChange={(e) => {
                const val = parseInt(e.target.value) || portRange.min;
                const newPortCount = Math.max(portRange.min, Math.min(portRange.max, val));
                setPortCount(newPortCount);
                
                // スイッチの場合、ポート種別の数値も連動させる
                if (isSwitch) {
                  const diff = newPortCount - portCount;
                  if (diff > 0) {
                    // ポート数が増えた場合、イーサネットに追加
                    setEthernetPortCount(ethernetPortCount + diff);
                  } else if (diff < 0) {
                    // ポート数が減った場合、光ポートから減らし、足りなければイーサネットから減らす
                    const opticalReduction = Math.min(opticalPortCount, Math.abs(diff));
                    const ethernetReduction = Math.abs(diff) - opticalReduction;
                    setOpticalPortCount(opticalPortCount - opticalReduction);
                    setEthernetPortCount(ethernetPortCount - ethernetReduction);
                  }
                }
              }}
              inputProps={{ min: portRange.min, max: portRange.max, step: 1 }}
              helperText={`${portRange.min}〜${portRange.max}`}
              fullWidth
              size="small"
            />
          )}

          {/* マスタ局のパラメータ */}
          {isMaster && (
            <>
              {/* 最大接続局数（汎用マスタのみ編集可） */}
              <TextField
                label="最大接続局数"
                type="number"
                value={maxStations}
                onChange={(e) => setMaxStations(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={!currentData.isGenericMaster}
                helperText={!currentData.isGenericMaster ? '汎用マスタ局のみ編集可能' : ''}
                inputProps={{ min: 1, step: 1 }}
                fullWidth
                size="small"
              />
              <TextField
                label="ファームウェアバージョン"
                type="number"
                value={firmwareVersion}
                onChange={(e) => setFirmwareVersion(e.target.value === '' ? '' : Number(e.target.value))}
                inputProps={{ min: 0, step: 1 }}
                fullWidth
                size="small"
              />
              <FormControl fullWidth size="small">
                <InputLabel>プロトコルバージョン</InputLabel>
                <Select
                  value={protocolVersion}
                  onChange={(e) => setProtocolVersion(e.target.value as any)}
                  label="プロトコルバージョン"
                >
                  <MenuItem value="">未設定</MenuItem>
                  <MenuItem value="1.0">1.0</MenuItem>
                  <MenuItem value="2.0">2.0</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>マルチキャストフィルタ対応</InputLabel>
                <Select
                  value={supportsMulticastFilter}
                  onChange={(e) => setSupportsMulticastFilter(e.target.value as any)}
                  label="マルチキャストフィルタ対応"
                >
                  <MenuItem value="未設定">未設定</MenuItem>
                  <MenuItem value="対応">対応</MenuItem>
                  <MenuItem value="非対応">非対応</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>リング対応可否</InputLabel>
                <Select
                  value={isRingCapable}
                  onChange={(e) => setIsRingCapable(e.target.value as any)}
                  label="リング対応可否"
                >
                  <MenuItem value="未設定">未設定</MenuItem>
                  <MenuItem value="対応">対応</MenuItem>
                  <MenuItem value="非対応">非対応</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="ハードウェアバージョン"
                type="number"
                value={hardwareVersion}
                onChange={(e) => setHardwareVersion(e.target.value === '' ? '' : Number(e.target.value))}
                inputProps={{ min: 0, step: 1 }}
                fullWidth
                size="small"
              />
            </>
          )}

          {/* ローカル局・リモート局のパラメータ */}
          {isLocalOrRemote && (
            <>
              <TextField
                label="ファームウェアバージョン"
                type="number"
                value={firmwareVersion}
                onChange={(e) => setFirmwareVersion(e.target.value === '' ? '' : Number(e.target.value))}
                inputProps={{ min: 0, step: 1 }}
                fullWidth
                size="small"
              />
              <FormControl fullWidth size="small">
                <InputLabel>プロトコルバージョン</InputLabel>
                <Select
                  value={protocolVersion}
                  onChange={(e) => setProtocolVersion(e.target.value as any)}
                  label="プロトコルバージョン"
                >
                  <MenuItem value="">未設定</MenuItem>
                  <MenuItem value="1.0">1.0</MenuItem>
                  <MenuItem value="2.0">2.0</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>周期設定</InputLabel>
                <Select
                  value={cycleSetting}
                  onChange={(e) => setCycleSetting(e.target.value as any)}
                  label="周期設定"
                >
                  <MenuItem value="">未設定</MenuItem>
                  <MenuItem value="LOW">低速</MenuItem>
                  <MenuItem value="MID">中速</MenuItem>
                  <MenuItem value="BASIC">基本周期</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="RX・RWr・LB・LW設定の合計バイト数"
                type="number"
                value={cyclicDataBytes}
                onChange={(e) => setCyclicDataBytes(e.target.value === '' ? '' : Number(e.target.value))}
                inputProps={{ min: 0, step: 1 }}
                fullWidth
                size="small"
              />
              <FormControl fullWidth size="small">
                <InputLabel>マルチキャストフィルタ対応</InputLabel>
                <Select
                  value={supportsMulticastFilter}
                  onChange={(e) => setSupportsMulticastFilter(e.target.value as any)}
                  label="マルチキャストフィルタ対応"
                >
                  <MenuItem value="未設定">未設定</MenuItem>
                  <MenuItem value="対応">対応</MenuItem>
                  <MenuItem value="非対応">非対応</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>リング対応可否</InputLabel>
                <Select
                  value={isRingCapable}
                  onChange={(e) => setIsRingCapable(e.target.value as any)}
                  label="リング対応可否"
                >
                  <MenuItem value="未設定">未設定</MenuItem>
                  <MenuItem value="対応">対応</MenuItem>
                  <MenuItem value="非対応">非対応</MenuItem>
                </Select>
              </FormControl>
            </>
          )}

          {/* スイッチのパラメータ */}
          {isSwitch && (
            <>
              {/* 光ポート・イーサネットポート設定 */}
              <Box sx={{ border: '1px solid #ddd', borderRadius: 1, p: 2, backgroundColor: '#f9f9f9' }}>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
                  ポート種別
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, justifyContent: 'space-around' }}>
                  <Box sx={{ flex: 1, textAlign: 'center' }}>
                    <Typography variant="body1" sx={{ mb: 1, fontWeight: 'medium' }}>
                      イーサネット
                    </Typography>
                    <TextField
                      type="number"
                      value={ethernetPortCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        const newEthernet = Math.max(0, Math.min(portCount, val));
                        setEthernetPortCount(newEthernet);
                        setOpticalPortCount(portCount - newEthernet);
                      }}
                      inputProps={{ min: 0, max: portCount, step: 1 }}
                      size="small"
                      sx={{ width: '100px' }}
                    />
                  </Box>
                  <Box sx={{ flex: 1, textAlign: 'center' }}>
                    <Typography variant="body1" sx={{ mb: 1, fontWeight: 'medium' }}>
                      光ケーブル
                    </Typography>
                    <TextField
                      type="number"
                      value={opticalPortCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        const newOptical = Math.max(0, Math.min(portCount, val));
                        setOpticalPortCount(newOptical);
                        setEthernetPortCount(portCount - newOptical);
                      }}
                      inputProps={{ min: 0, max: portCount, step: 1 }}
                      size="small"
                      sx={{ width: '100px' }}
                    />
                  </Box>
                </Box>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  マルチキャスト転送禁止設定ポート
                </Typography>
                <FormGroup row>
                  {Array.from({ length: portCount }, (_, i) => {
                    const portId = `port${i + 1}`;
                    return (
                      <FormControlLabel
                        key={portId}
                        control={
                          <Checkbox
                            checked={forbiddenPorts.has(portId)}
                            onChange={() => handleForbiddenPortToggle(portId)}
                          />
                        }
                        label={portId}
                      />
                    );
                  })}
                </FormGroup>
              </Box>
            </>
          )}

          {/* 汎用機器およびデフォルトがイーサネットで光ケーブル対応のデバイス用のポート種別設定 */}
          {(isGenericDevice || (currentData.defaultPortType === 'ethernet' && currentData.supportsOpticalPorts === true)) && !isSwitch && (
            <Box sx={{ border: '1px solid #ddd', borderRadius: 1, p: 2, backgroundColor: '#f9f9f9' }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 'bold' }}>
                ポート種別
              </Typography>
              <FormControl component="fieldset">
                <RadioGroup
                  row
                  value={portType}
                  onChange={(e) => setPortType(e.target.value as 'ethernet' | 'optical')}
                >
                  <FormControlLabel
                    value="ethernet"
                    control={<Radio />}
                    label="イーサネット"
                  />
                  <FormControlLabel
                    value="optical"
                    control={<Radio />}
                    label="光ケーブル"
                  />
                </RadioGroup>
              </FormControl>
              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#666' }}>
                全ポートが同じ種別になります
              </Typography>
            </Box>
          )}

          {/* Ethernet機器（パラメータなし） */}
          {isEthernet && (
            <Typography variant="body2" color="text.secondary">
              （他のパラメータはありません）
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={handleSave} variant="contained" color="primary">
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
