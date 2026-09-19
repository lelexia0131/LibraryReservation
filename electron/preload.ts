import { contextBridge, ipcRenderer } from 'electron';
import { channels, type LibraryApp } from './contracts.js';

const api: LibraryApp = {
  getAuthStatus: () => ipcRenderer.invoke(channels.status),
  login: () => ipcRenderer.invoke(channels.login),
  logout: () => ipcRenderer.invoke(channels.logout),
  openBookingWebsite: () => ipcRenderer.invoke(channels.website),
  listAvailability: input => ipcRenderer.invoke(channels.availability, input),
  listSeats: input => ipcRenderer.invoke(channels.seats, input),
  reserveManual: input => ipcRenderer.invoke(channels.manual, input),
  startAutoSelect: input => ipcRenderer.invoke(channels.autoStart, input),
  stopAutoSelect: () => ipcRenderer.invoke(channels.autoStop),
  getAutoSelectStatus: () => ipcRenderer.invoke(channels.autoStatus),
};
contextBridge.exposeInMainWorld('libraryApp', Object.freeze(api));
