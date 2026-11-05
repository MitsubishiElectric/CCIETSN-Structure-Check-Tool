// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Alert } from '@mui/material';
import type { Node } from 'reactflow';

interface StationNumberDialogProps {
  open: boolean;
  currentNumber: number;
  nodeId: string;
  nodes: Node[];
  onClose: () => void;
  onSave: (nodeId: string, newNumber: number) => void;
}

export const StationNumberDialog = ({ open, currentNumber, nodeId, nodes, onClose, onSave }: StationNumberDialogProps) => {
  const [inputValue, setInputValue] = useState(String(currentNumber));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInputValue(String(currentNumber));
      setError(null);
    }
  }, [open, currentNumber]);

  const handleSave = () => {
    const num = parseInt(inputValue, 10);

    // 範囲チェック
    if (isNaN(num) || num < 1 || num > 253) {
      setError('局番は1~253の範囲で入力してください');
      return;
    }

    // 重複チェック(自分以外で同じ番号が使われているか)
    const duplicate = nodes.find(n => {
      if (n.id === nodeId) return false; // 自分自身は除外
      const stationNumber = (n.data as any)?.stationNumber;
      return stationNumber === num;
    });

    if (duplicate) {
      // 重複がある場合: 入れ替え確認
      setError(`No.${num}は既に使用されています。入れ替えますか?`);
      return;
    }

    // 重複なし: そのまま保存
    onSave(nodeId, num);
    onClose();
  };

  const handleSwap = () => {
    const num = parseInt(inputValue, 10);
    if (isNaN(num)) return;

    // 入れ替え処理
    onSave(nodeId, num);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>局番を変更</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="局番 (1-253)"
          type="number"
          fullWidth
          size="small"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (error?.includes('入れ替えますか')) {
                handleSwap();
              } else {
                handleSave();
              }
            }
          }}
          inputProps={{ min: 1, max: 253 }}
        />
        {error && (
          <Alert severity={error.includes('入れ替えますか') ? 'warning' : 'error'} sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        {error?.includes('入れ替えますか') ? (
          <Button onClick={handleSwap} variant="contained" color="warning">入れ替える</Button>
        ) : (
          <Button onClick={handleSave} variant="contained">保存</Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
