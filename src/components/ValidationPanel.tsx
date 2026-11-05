// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import {
  Box,
  Paper,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  IconButton,
} from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import { NetworkValidationResult, ValidationResult } from '../types/validation';

interface ValidationPanelProps {
  validationResult: NetworkValidationResult | null;
  onClose: () => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  validationResult,
  onClose,
}) => {
  if (!validationResult) {
    return null;
  }

  const { results } = validationResult;
  
  // スイッチなしエラーの判定ロジック
  const isNoSwitchError = (r: ValidationResult) => {
    return r.severity === 'warning' && 
           (r.status === 'ALLOW_VIA_SWITCH' || r.status === 'ALLOW_VIA_SWITCH_PENDING') &&
           r.message?.includes('産業用スイッチ経由が必要');
  };
  
  const errorCount = results.filter((r) => r.severity === 'error' || isNoSwitchError(r)).length;
  const warningCount = results.filter((r) => r.severity === 'warning' && !isNoSwitchError(r)).length;
  const valid = errorCount === 0;

  return (
    <Paper
      data-testid="validation-panel"
      sx={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 350,
        maxHeight: 500,
        overflow: 'auto',
        p: 2,
        bgcolor: 'background.paper',
        boxShadow: 3,
        zIndex: 10,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>構成チェック</Typography>
        {valid ? (
          <Chip
            icon={<CheckCircleIcon />}
            label="OK"
            color="success"
            size="small"
          />
        ) : (
          <Chip
            icon={<ErrorIcon />}
            label="エラーあり"
            color="error"
            size="small"
          />
        )}
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {results.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleIcon color="success" />
          <Typography variant="body2" color="success.main">
            問題は検出されませんでした
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            {errorCount > 0 && (
              <Chip
                label={`エラー: ${errorCount}`}
                color="error"
                size="small"
              />
            )}
            {warningCount > 0 && (
              <Chip
                label={`警告: ${warningCount}`}
                color="warning"
                size="small"
              />
            )}
          </Box>

          <List dense>
            {results.map((result) => (
              <ValidationResultItem key={result.id} result={result} />
            ))}
          </List>
        </>
      )}
    </Paper>
  );
};

const ValidationResultItem: React.FC<{ result: ValidationResult }> = ({
  result,
}) => {
  // ALLOW_VIA_SWITCHでスイッチがない場合はERRORとして扱う
  const isNoSwitchError = result.severity === 'warning' && 
                          (result.status === 'ALLOW_VIA_SWITCH' || result.status === 'ALLOW_VIA_SWITCH_PENDING') &&
                          result.message?.includes('産業用スイッチ経由が必要');
  
  const displaySeverity = isNoSwitchError ? 'error' : result.severity;

  const getIcon = () => {
    switch (displaySeverity) {
      case 'error':
        return <ErrorIcon color="error" />;
      case 'warning':
        return <WarningIcon color="warning" />;
      case 'info':
        return <InfoIcon color="info" />;
    }
  };

  const getStatusColor = () => {
    // スイッチなしエラーの場合は赤
    if (isNoSwitchError) {
      return 'error';
    }
    
    switch (result.status) {
      case 'DENY':
        return 'error';
      case 'ALLOW_PENDING':
      case 'ALLOW_VIA_SWITCH_PENDING':
        return 'warning';
      case 'ALLOW_VIA_SWITCH':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <ListItem
      data-testid={`validation-item-${displaySeverity}`}
      data-status={result.status}
      sx={{
        flexDirection: 'column',
        alignItems: 'flex-start',
        borderBottom: '1px solid',
        borderColor: 'divider',
        py: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: '100%' }}>
        <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>{getIcon()}</ListItemIcon>
        <Box sx={{ flex: 1 }}>
          <ListItemText
            primary={result.message}
            primaryTypographyProps={{ variant: 'body2' }}
          />
          {result.details && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
              {result.details}
            </Typography>
          )}
          <Chip
            label={result.status}
            size="small"
            color={getStatusColor()}
            sx={{ mt: 0.5 }}
          />
        </Box>
      </Box>
    </ListItem>
  );
};
