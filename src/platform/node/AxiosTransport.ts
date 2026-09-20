import axios, { type AxiosInstance } from 'axios';
import { HttpTransportError, type HttpTransport } from '../../api/HttpTransport.js';

export function createAxiosTransport(client: AxiosInstance = axios.create({
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', lang: 'zh' },
})): HttpTransport {
  return { async post(path, payload, options) {
    try { return { data: (await client.post(path, payload, options)).data }; }
    catch (error) {
      const header = axios.isAxiosError(error) ? error.response?.headers['retry-after'] : undefined;
      throw new HttpTransportError(axios.isAxiosError(error) ? error.response?.status : undefined,
        axios.isAxiosError(error) ? error.code : undefined,
        typeof header === 'string' || typeof header === 'number' ? header : undefined);
    }
  } };
}
