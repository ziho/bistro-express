import type { Context } from 'hono';
import type { AppContext } from '../context.js';

export type Listener = 'public' | 'admin';

export interface HonoEnv {
  Variables: {
    app: AppContext;
    listener: Listener;
  };
}

export type Ctx = Context<HonoEnv>;
