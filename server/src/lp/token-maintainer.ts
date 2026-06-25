import { EventEmitter } from 'node:events';
import type { AgentIdentity } from './lp-auth.js';

/**
 * A minimal token maintainer that hands the SDK a bearer we already obtained
 * (via Sentinel SSO), instead of letting the SDK do an agentVep username/password
 * login. The SDK's BrandWebsocketConnection only needs this small contract:
 *   start(), stop(), getToken(), getAuthSessionInfo(), onTokenInvalid(reason)
 *   props: agentId (accountId.shortId), userId (UUID)
 * and it must be an EventEmitter (the connection wires .on('error'|'token-invalid'|…)).
 *
 * No refresh logic for the POC: if the bearer expires the websocket drops and the
 * user re-authenticates. (Sentinel refresh_token support could be added here.)
 */
export class StaticTokenMaintainer extends EventEmitter {
  readonly agentId: string;
  readonly userId: string;
  private token: string;

  constructor(identity: AgentIdentity) {
    super();
    this.token = identity.bearer;
    this.agentId = identity.agentId;
    this.userId = identity.userPid;
  }

  async start(): Promise<void> {
    /* nothing to do — token already obtained */
  }

  stop(): void {
    this.removeAllListeners();
  }

  async getToken(): Promise<string> {
    return this.token;
  }

  async getAuthSessionInfo(): Promise<{ token: string; userId: string; userPid: string }> {
    return { token: this.token, userId: this.agentId.split('.')[1] ?? '', userPid: this.userId };
  }

  onTokenInvalid(reason: string): void {
    this.emit('token-invalid', reason);
  }

  updateToken(token: string): void {
    this.token = token;
  }
}
