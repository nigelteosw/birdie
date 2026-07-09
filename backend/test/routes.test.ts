import { describe, expect, it } from 'bun:test';
import { buildLocalContext } from '../src/context.js';
import { createServer } from '../src/server.js';

describe('REST app', () => {
  it('constructs the Express app with local services', () => {
    const app = createServer(buildLocalContext(':memory:', '/nonexistent/domain.md'));
    expect(typeof app).toBe('function');
    expect(app.get).toBeFunction();
    expect(app.use).toBeFunction();
  });
});
