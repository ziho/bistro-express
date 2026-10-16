export interface PushMessage {
  title: string;
  body: string;
  /** Public deep link to the plan. */
  url: string;
  group: string;
}

/** One destination of a channel (e.g. a Bark device). Never carries secrets. */
export interface Recipient {
  id: string;
  label: string;
}

/**
 * Adapter boundary for notification channels. Bark is the only implementation today;
 * a Feishu (or other) provider only needs to implement this interface.
 *
 * Each recipient is delivered (and retried) independently by the worker, so a failure on one
 * device never re-sends to a device that already accepted the message.
 *
 * `send` resolving means the provider *accepted* the message — never that anyone read it.
 */
export interface NotificationProvider {
  readonly name: string;
  /** Recipients a newly queued message should go to right now. Empty = channel not configured. */
  listRecipients(): Recipient[];
  /** Why this recipient cannot receive right now (disabled, removed, channel off), or null. */
  unavailableReason(recipientId: string): string | null;
  send(recipientId: string, message: PushMessage): Promise<void>;
}

export class ProviderError extends Error {}
