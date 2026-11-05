// SPDX-License-Identifier: Apache-2.0
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';

const theme = createTheme({
  palette: {
    mode: 'light'
  }
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
