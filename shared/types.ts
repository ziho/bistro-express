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

/** Per-recipient delivery state. 'skipped' = device disabled/removed or channel switched off. */
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'superseded';

/** Recipient tallies for one notification (superseded recipients are not counted). */
export interface DeliveryCounts {
  total: number;
  sent: number;
  failed: number;
  /** Still waiting (pending or sending). */
  pending: number;
  skipped: number;
}

export interface NotificationSummary {
  id: string;
  event: PlanEvent;
  /**
   * Aggregate over all recipients: 'sent' only when every recipient accepted the push.
   * Partial results stay 'pending' / 'failed' / 'unconfigured' — see `delivery` for counts.
   */
  status: NotificationStatus;
  /** Highest attempt count among recipients. */
  attempts: number;
  lastError: string | null;
  planVersion: number;
  updatedAt: string;
  /** null for notifications that never had recipients (unconfigured, or recorded before multi-device). */
  delivery: DeliveryCounts | null;
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

export interface BarkDeviceView {
  id: string;
  label: string;
  /** The raw key is never sent to clients. */
  keyMasked: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BarkSettingsView {
  /** Global switch. */
  enabled: boolean;
  serverUrl: string;
  /** Masked key of the first device (kept for older clients). */
  deviceKeyMasked: string | null;
  /** Enabled globally, valid server, and at least one enabled device. */
  configured: boolean;
  devices: BarkDeviceView[];
  maxDevices: number;
}

export interface BarkTestResult {
  id: string;
  label: string;
  ok: boolean;
  error: string | null;
}

export interface AdminDelivery {
  targetId: string;
  label: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  updatedAt: string;
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
  deliveries: AdminDelivery[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Result of parsing a Google Maps link. Nothing here is fetched from Google's Places data. */
export interface MapLinkPreview {
  /** Link found in the pasted text. */
  sourceUrl: string;
  /** Final Google Maps URL after expanding short links, tracking parameters removed. */
  resolvedUrl: string;
  /** Suggested value for the restaurant's map link (within the URL length limit), or null. */
  mapUrl: string | null;
  expanded: boolean;
  name: string | null;
  /** 'place' = from /maps/place/<name>; 'query' = from a search query (less reliable). */
  nameSource: 'place' | 'query' | null;
  nameTruncated: boolean;
  /** The place's own point (data !3d/!4d or a coordinate query). */
  place: LatLng | null;
  /** Map viewport centre from "@lat,lng,zoom" — NOT the restaurant's location. */
  camera: (LatLng & { zoom: number | null }) | null;
  identifiers: {
    placeId: string | null;
    ftid: string | null;
    cid: string | null;
    /** true when the CID was computed from the FTID rather than present in the link. */
    cidDerived: boolean;
    kgId: string | null;
  };
  duplicates: { id: string; name: string; active: boolean; matchedBy: string[] }[];
  notes: string[];
}
