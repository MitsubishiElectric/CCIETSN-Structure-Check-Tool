// SPDX-License-Identifier: Apache-2.0
import { GitHub, Redo, Undo } from '@mui/icons-material';
import { AppBar, Box, Button, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect } from 'react';
import { ReactFlowProvider } from 'reactflow';

import FlowEditor from './components/FlowEditor';
import { useFlowStore } from './store/flowStore';
import { exportAsJson } from './utils/exporters';
import type { FlowSerializable } from './types/flow';

export default function App() {
  const { toSerializable, undo, redo, history, future, loadFromSerializable } = useFlowStore() as any;

  const handleImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const json = JSON.parse(text) as Partial<FlowSerializable>;
        // 最低限のスキーマ検証
        if (!json || typeof json !== 'object') throw new Error('Invalid JSON');
        if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) throw new Error('nodes/edges missing');
        // version マイグレーション (将来拡張余地)
        const version = typeof json.version === 'number' ? json.version : 1;
        const imported: FlowSerializable = {
          nodes: json.nodes as any,
          edges: json.edges as any,
          version,
          updatedAt: new Date().toISOString(),
          communicationMode: json.communicationMode // ユニキャスト/マルチキャスト設定を保持
        };
        loadFromSerializable(imported);
      } catch (e: any) {
        alert('Import failed: ' + (e?.message || e));
      }
    };
    reader.readAsText(file);
  }, []);

  const triggerFileDialog = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) handleImport(file);
    };
    input.click();
  };

  const handleExport = useCallback(() => {
    const data = toSerializable();
    exportAsJson(data, 'flowchart.json');
  }, [toSerializable]);

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z') {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" color="primary" sx={{ flexShrink: 0 }}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            CC-Link IE TSN 構成チェックツール
          </Typography>
          <Tooltip title="元に戻す (Ctrl+Z)">
            <span>
              <IconButton
                color="inherit"
                onClick={handleUndo}
                disabled={history.length === 0}
                size="small"
              >
                <Undo />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="やり直し (Ctrl+Y)">
            <span>
              <IconButton
                color="inherit"
                onClick={handleRedo}
                disabled={future.length === 0}
                size="small"
              >
                <Redo />
              </IconButton>
            </span>
          </Tooltip>
          {/* Global class/speed toggles removed (always per-node now) */}
          <Button color="inherit" size="small" onClick={triggerFileDialog} sx={{ mr: 1 }}>
            Import JSON
          </Button>
          <Button color="inherit" size="small" onClick={handleExport}>Export JSON</Button>
          <Tooltip title="GitHub Repository">
            <IconButton
              color="inherit"
              size="small"
              component="a"
              href="https://github.com/MitsubishiElectric/CCIETSN-Structure-Check-Tool"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub Repository"
              sx={{ ml: 1 }}
            >
              <GitHub />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <FlowEditor />
        </ReactFlowProvider>
      </Box>
    </Box>
  );
}
