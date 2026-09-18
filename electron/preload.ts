import { contextBridge, ipcRenderer } from 'electron';
import { channels, type LibraryApp } from './contracts.js';

const api: LibraryApp = {
  getAuthStatus: () => ipcRenderer.invoke(channels.status),
  login: () => ipcRenderer.invoke(channels.login),
  logout: () => ipcRenderer.invoke(channels.logout),
  openBookingWebsite: () => ipcRenderer.invoke(channels.website),
  runDryBooking: input => ipcRenderer.invoke(channels.query, input),
};
contextBridge.exposeInMainWorld('libraryApp', Object.freeze(api));
