export interface PushMessage {
  title: string;
  body: string;
  /** Public deep link to the plan. */
  url: string;
  group: string;
}

/**
 * Adapter boundary for notification channels. Bark is the only implementation today;
 * a Feishu (or other) provider only needs to implement this interface.
 *
 * `send` resolving means the provider *accepted* the message — never that anyone read it.
 */
export interface NotificationProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: PushMessage): Promise<void>;
}

export class ProviderError extends Error {}
