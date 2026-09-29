import { contextBridge, ipcRenderer } from 'electron';

// Мост окна (contextIsolation + sandbox): только эти функции, никакого Node в странице.
contextBridge.exposeInMainWorld('erpShell', {
  onStatus: (cb: (text: string) => void) => { ipcRenderer.on('status', (_e, text: string) => cb(text)); },
  setupDefaults: (): Promise<{ serverUrl: string; deviceName: string }> => ipcRenderer.invoke('setup-defaults'),
  register: (input: { serverUrl: string; email: string; password: string; deviceName: string }): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('register', input),
});
