export interface TokenProvider {
  getToken(): Promise<string>;
  invalidateToken?(rejectedToken: string): Promise<void>;
}
