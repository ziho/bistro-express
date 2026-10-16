export type PlanMode = 'home' | 'restaurant';
export type PlanStatus = 'active' | 'cancelled';
export type PlanEvent = 'created' | 'updated' | 'cancelled';

export type NotificationStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'superseded'
  | 'unconfigured';

export interface Dish {
  id: string;
  name: string;
  imageAssetId: string | null;
  category: string;
  tags: string[];
  description: string;
  recipeUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Restaurant {
  id: string;
  name: string;
  imageAssetId: string | null;
  cuisine: string;
  tags: string[];
  budgetText: string;
  address: string;
  mapUrl: string | null;
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Frozen copy of a dish at the time a plan was saved. */
export interface DishSnapshot {
  id: string;
  name: string;
  category: string;
  imageAssetId: string | null;
}

/** Frozen copy of a restaurant at the time a plan was saved. */
export interface RestaurantSnapshot {
  id: string;
  name: string;
  cuisine: string;
  imageAssetId: string | null;
  budgetText: string;
  address: string;
  mapUrl: string | null;
}

export interface NotificationSummary {
  id: string;
  event: PlanEvent;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  planVersion: number;
  updatedAt: string;
}

export interface Plan {
  id: string;
  shortId: string;
  status: PlanStatus;
  version: number;
  date: string;
  mealLabel: string;
  localTime: string | null;
  timeZone: string;
  instant: string | null;
  mode: PlanMode;
  note: string;
  dishes: DishSnapshot[];
  candidates: RestaurantSnapshot[];
  selectedRestaurant: RestaurantSnapshot | null;
  sourcePlanId: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  notification: NotificationSummary | null;
}

export interface PlanInput {
  date: string;
  mealLabel: string;
  localTime: string | null;
  timeZone: string;
  mode: PlanMode;
  note: string;
  dishIds: string[];
  candidateIds: string[];
  selectedRestaurantId: string | null;
  sourcePlanId?: string | null;
}

export interface Catalog {
  dishes: Dish[];
  restaurants: Restaurant[];
}

export interface SessionInfo {
  listener: 'public' | 'admin';
  guest: boolean;
  admin: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface BarkSettingsView {
  enabled: boolean;
  serverUrl: string;
  deviceKeyMasked: string | null;
  configured: boolean;
}

export interface AdminNotification extends NotificationSummary {
  planId: string;
  planShortId: string;
  provider: string;
  title: string;
  body: string;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
}
