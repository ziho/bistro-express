export type PlanMode = 'home' | 'restaurant';
/** What a venue (and a restaurant-mode plan) is for: 去吃饭 or 饮品 / 甜品. Home plans are always 'meal'. */
export type VenuePurpose = 'meal' | 'treat';
/** Kind of a drinks / dessert venue (see shared/treatType.ts): 奶茶, 咖啡, 糖水／甜品, 雪糕, 蛋糕, 面包／烘焙, 其他. */
export type TreatType = 'milk_tea' | 'coffee' | 'tong_sui' | 'ice_cream' | 'cake' | 'bakery' | 'other';
export type PlanStatus = 'active' | 'cancelled';
export type PlanEvent = 'created' | 'updated' | 'cancelled';

export type NotificationStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'superseded'
  | 'unconfigured';

/** One main-ingredient row of a home-cooked dish (主料). Quantity and note are free text. */
export interface DishIngredient {
  name: string;
  /** e.g. 半盒 / 一把 / 约300g / 适量; '' when not recorded. */
  quantity: string;
  /** Row-specific purchase reminder, e.g. 去骨鸡腿; '' when not recorded. */
  purchaseNote: string;
}

/** Optional cooking / purchase details shared by a dish and its plan snapshot. */
export interface DishDetails {
  /** Menu sections (菜单分区), multi-select, in display order. */
  sections: string[];
  /** Main ingredients, not a complete ingredient list. */
  ingredients: DishIngredient[];
  /** 总耗时 in minutes, 0..1440; null when not recorded (0 is a real value). */
  totalMinutes: number | null;
  /** 动手时间 in minutes, 0..1440, never more than totalMinutes; null when not recorded. */
  activeMinutes: number | null;
  /** 份量, e.g. 一盘（两人分享）; '' when not recorded. */
  servingText: string;
  /** Overall purchase reminder; '' when not recorded. */
  shoppingNote: string;
}

export interface Dish extends DishDetails {
  id: string;
  name: string;
  imageAssetId: string | null;
  /** @deprecated Older clients only: the first menu section, or '' when there is none. */
  category: string;
  tags: string[];
  description: string;
  recipeUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One external page for a restaurant (menu, official website, booking…). */
export interface RestaurantLink {
  /** Display name; empty means DEFAULT_LINK_LABEL. */
  label: string;
  /** Absolute http(s) URL (see isSafeExternalUrl). */
  url: string;
}

/**
 * Where a venue is, as free text (all optional). `country` is shown as written (usually Chinese,
 * e.g. 加拿大); `region` (state / province) and `city` are English when known, otherwise local.
 * `countryCode` is an upper-case ISO 3166-1 alpha-2 code, or '' when unknown / typed by hand.
 */
export interface VenueLocation {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  /** 'osm' = values as suggested by the OpenStreetMap lookup; 'manual' = typed/edited; '' = nothing recorded. */
  source: 'osm' | 'manual' | '';
}

export interface Restaurant {
  id: string;
  name: string;
  imageAssetId: string | null;
  /** 一句话点评. */
  review: string;
  /** 分类标签 — the only classification (the old single "cuisine" was merged into tags). */
  tags: string[];
  budgetText: string;
  address: string;
  /** Google Maps link. */
  mapUrl: string | null;
  /** Other relevant pages (menu, official website…) in display order, at most LIMITS.restaurantLinks. */
  links: RestaurantLink[];
  /** Longer free-form note (备注). */
  note: string;
  location: VenueLocation;
  /** At least one; venues saved before migration 7 are ['meal']. */
  purposes: VenuePurpose[];
  /**
   * Deprecated compatibility field, derived from tags for live venues. Classification is only
   * edited through tags; historical plan snapshots keep their original values.
   */
  treatTypes: TreatType[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Frozen copy of a dish at the time a plan was saved. Snapshots stored before the dish details
 * existed only have id/name/category/imageAssetId; they are normalized on read (see
 * readDishSnapshot): the old category becomes the one section and every other field is empty.
 */
export interface DishSnapshot extends DishDetails {
  id: string;
  name: string;
  /** @deprecated The first section, or '' when there is none. */
  category: string;
  imageAssetId: string | null;
  tags: string[];
  description: string;
  recipeUrl: string | null;
}

/**
 * Frozen copy of a restaurant at the time a plan was saved. Snapshots stored before the
 * tags/review/link fields existed are normalized on read: their cuisine becomes the tags, and a
 * single legacy linkUrl/linkLabel (snapshots without a `links` array) becomes one link.
 */
export interface RestaurantSnapshot {
  id: string;
  name: string;
  imageAssetId: string | null;
  review: string;
  tags: string[];
  budgetText: string;
  address: string;
  mapUrl: string | null;
  links: RestaurantLink[];
  /** Empty for snapshots saved before migration 7 (never filled in from the current catalog). */
  location: VenueLocation;
  /** ['meal'] for snapshots saved before migration 7. */
  purposes: VenuePurpose[];
  /** [] for snapshots saved before migration 8 (never filled in from the current catalog or inferred). */
  treatTypes: TreatType[];
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
  /** 'treat' = a drinks / dessert outing (restaurant mode only); everything else is 'meal'. */
  purpose: VenuePurpose;
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
  /** Optional for older clients: omitted on create means 'meal', omitted on update keeps the saved purpose. */
  purpose?: VenuePurpose;
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
  /** True on the private listener (network access, no password/session required). */
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

/** One page of the admin notification history (only the retained recent window). */
export interface NotificationPage {
  items: AdminNotification[];
  /** Page actually returned: a page past the end is clamped to the last page (1 when empty). */
  page: number;
  pageSize: number;
  /** Retained records across all pages. */
  total: number;
  /** At least 1, even when there are no records. */
  totalPages: number;
  /** Failed or unconfigured records across all retained pages (what 「重试全部」 targets). */
  held: number;
  retentionDays: number;
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
  duplicates: RestaurantDuplicate[];
  notes: string[];
  /** Region suggestion; only present when the request asked for it (geo: true). */
  geo?: GeoOutcome;
}

/** A region suggested by the reverse lookup of a link's own place point. Only fields the provider returned. */
export interface LocationSuggestion {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  /** The provider's own country name (English), kept when no Chinese name is known. */
  providerCountry: string;
  attribution: string;
  attributionUrl: string;
}

/**
 * Result of the optional region lookup. A failed lookup never fails the link preview itself.
 * - suggested: values to offer (never applied over manual input without confirmation)
 * - no_point: the link has no reliable place coordinates (search / camera / ID only) — fill in by hand
 * - not_found: the provider has no country / region / city for that point
 * - unavailable: network, timeout, busy or provider error — may be retried later by hand
 * - disabled: the lookup is switched off in 推送设置 → 地区识别
 */
export type GeoOutcome =
  | { status: 'suggested'; suggestion: LocationSuggestion; cached: boolean }
  | { status: 'no_point' | 'not_found' | 'unavailable' | 'disabled'; message: string };

export interface GeoSettingsView {
  enabled: boolean;
  baseUrl: string;
  defaultBaseUrl: string;
  /** true when nothing has been saved yet and the built-in defaults apply. */
  isDefault: boolean;
  policyUrl: string;
  attribution: string;
  attributionUrl: string;
  minIntervalMs: number;
  cacheDays: number;
}

/** An existing restaurant whose saved map link points at the same place. */
export interface RestaurantDuplicate {
  id: string;
  name: string;
  active: boolean;
  matchedBy: string[];
}

/** One row of POST /admin/restaurants/import. `clientId` is the browser queue's stable row id. */
export interface RestaurantImportRow {
  clientId: string;
  name: string;
  /** Canonical map link (or the strict Google link itself when it could not be expanded). */
  mapUrl: string;
  /** The pasted link, so saved short links are recognised as duplicates. */
  sourceUrl: string | null;
  tags: string[];
  /** Optional (older drafts omit them): blank location and ['meal']. */
  location?: VenueLocation;
  purposes?: VenuePurpose[];
  /** Omitted: inferred from exact known tags for a treat venue; [] = 未分类. */
  treatTypes?: TreatType[];
}

export type RestaurantImportResult =
  | { clientId: string; status: 'created'; restaurant: { id: string; name: string } }
  | { clientId: string; status: 'duplicate'; message: string; duplicates: RestaurantDuplicate[] }
  | { clientId: string; status: 'error'; message: string; field: string | null };

export interface RestaurantImportResponse {
  results: RestaurantImportResult[];
  created: number;
  duplicates: number;
  errors: number;
  /** true when this is the stored answer to an earlier identical request (same Idempotency-Key). */
  replayed: boolean;
}

/** 待采购 / 家里已有（够这一餐用）/ 已买好. Mutually exclusive and reversible. */
export type ShoppingStatus = 'pending' | 'have' | 'bought';

/** One shopping item added by hand to a saved home meal (not part of any recipe). */
export interface ShoppingManualItem {
  id: string;
  name: string;
  /** Free text; '' when not given. */
  quantity: string;
  /** Free text; '' when not given. */
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** Where one requirement of a shopping group comes from, with its original free-text values. */
export type ShoppingSource =
  | {
      kind: 'dish';
      dishId: string;
      dishName: string;
      /** The ingredient row's original name (groups may merge case/whitespace variants). */
      name: string;
      quantity: string;
      purchaseNote: string;
    }
  | { kind: 'manual'; manualId: string; name: string; quantity: string; note: string };

/** Overall purchase reminder (shoppingNote) of one dish, shown apart from the ingredient groups. */
export interface ShoppingDishNote {
  dishId: string;
  dishName: string;
  note: string;
}

/** One ingredient group of a saved meal's checklist. */
export interface ShoppingItem {
  /** Normalized name; stable across reorderings and display-name case/space changes. */
  key: string;
  /** Display name (the first source's original name). */
  name: string;
  sources: ShoppingSource[];
  status: ShoppingStatus;
  /** The group's requirement changed after it was marked have/bought; it was reset to pending. */
  needsReview: boolean;
}

export type ShoppingLockReason = 'cancelled' | 'past' | 'restaurant';

/** GET /plans/:id/shopping and every shopping write response. */
export interface ShoppingList {
  planId: string;
  /** The meal version this list was derived from; writes must send it back as expectedPlanVersion. */
  planVersion: number;
  /** Independent shopping revision (0 = never written); writes must send it back as expectedRevision. */
  revision: number;
  writable: boolean;
  lockReason: ShoppingLockReason | null;
  items: ShoppingItem[];
  manual: ShoppingManualItem[];
  dishNotes: ShoppingDishNote[];
  /** Names of dishes in this meal without any recorded main ingredient. */
  dishesWithoutIngredients: string[];
  counts: Record<ShoppingStatus, number>;
  updatedAt: string | null;
}
