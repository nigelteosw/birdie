import { requestJson } from './http.js';
import type { DomainProfile } from '../domain.js';

interface DomainResponse {
  content: string;
}

export class RemoteDomainService {
  constructor(private serverUrl: string) {}

  async get(): Promise<DomainProfile> {
    return toDomainProfile(await requestJson<DomainResponse>(this.serverUrl, '/domain'));
  }

  async save(content: string): Promise<DomainProfile> {
    return toDomainProfile(
      await requestJson<DomainResponse>(this.serverUrl, '/domain', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      })
    );
  }
}

function toDomainProfile(response: DomainResponse): DomainProfile {
  return { raw: response.content };
}
