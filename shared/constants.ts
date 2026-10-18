/** Public path prefix. The app is only ever served below this path. */
export const BASE_PATH = '/bistro';
export const API_PATH = `${BASE_PATH}/api`;
export const ADMIN_UI_PATH = `${BASE_PATH}/admin`;
export const ADMIN_API_PATH = `${API_PATH}/admin`;

export const APP_NAME = 'Bistro Express';

export const GUEST_COOKIE = 'bx_guest';

export const GUEST_SESSION_SECONDS = 30 * 24 * 60 * 60;

export const LIMITS = {
  mealLabel: 20,
  note: 500,
  name: 60,
  shortText: 60,
  description: 600,
  tag: 16,
  tags: 12,
  /** Unified venue tags, including all former drinks/dessert types. Dish tags stay at 12. */
  restaurantTags: 24,
  url: 500,
  address: 200,
  /** Restaurant one-sentence review (一句话点评). */
  review: 160,
  /** Custom display name of one restaurant link. */
  linkLabel: 20,
  /** External links (menu, website…) per restaurant. */
  restaurantLinks: 8,
  maxDishesPerMeal: 30,
  maxCandidates: 20,
  uploadBytes: 20 * 1024 * 1024,
  maxInputPixels: 60_000_000,
  fullEdge: 1600,
  thumbEdge: 480,
} as const;

/** Home-cooked dish details (菜单分区、主料、耗时、份量、采购提醒). Shared by the server schema and the admin form. */
export const DISH_LIMITS = {
  /** Menu sections per dish. */
  sections: 8,
  /** One section label; same as the legacy single category, so every old category stays valid. */
  section: LIMITS.shortText,
  /** Main-ingredient rows per dish. */
  ingredients: 20,
  ingredientName: 40,
  /** Free text such as 半盒 / 一把 / 约300g / 适量 (no unit conversion). */
  ingredientQuantity: 60,
  /** Per-ingredient purchase reminder, e.g. 去骨鸡腿 / 嫩豆腐 / 常买品牌. */
  purchaseNote: 160,
  /** 份量, e.g. 一盘（两人分享） / 一人份. */
  servingText: 60,
  /** Overall purchase reminder for the dish. */
  shoppingNote: 300,
  /** Upper bound of 总耗时 / 动手时间, in whole minutes (one day). */
  maxMinutes: 1440,
} as const;

/** Suggested menu sections. Optional and multi-select; custom sections (incl. old categories) work the same way. */
export const SUGGESTED_MENU_SECTIONS = ['配饭菜', '饭面简餐', '汤羹', '小食甜品'] as const;

/** Button text for a restaurant's external link when no custom label is set. */
export const DEFAULT_LINK_LABEL = '查看链接';

/** How many of a restaurant's links are shown directly on its selection card (the rest live in 详情). */
export const CARD_QUICK_LINKS = 2;

export const MEAL_SUGGESTIONS = ['早午餐', '午餐', '晚餐', '下午茶', '宵夜'] as const;

/** Attempts per recipient device (each device retries independently). */
export const NOTIFY_MAX_ATTEMPTS = 5;

/**
 * Admin notification history. Records (and their per-device rows) older than the rolling
 * window — by notification creation time — are deleted permanently and never sent or retried.
 */
export const NOTIFICATION_HISTORY = {
  retentionDays: 14,
  retentionMs: 14 * 24 * 60 * 60_000,
  defaultPageSize: 10,
  maxPageSize: 50,
  /** Largest accepted `page` query value; larger pages beyond the data clamp to the last page. */
  maxPage: 100_000,
  /** Size of the legacy no-query list (older admin tabs). */
  legacyLimit: 200,
} as const;

export const BARK_LIMITS = {
  maxDevices: 10,
  label: 30,
} as const;

/** Longest pasted text/link accepted by the Google Maps link importer. */
export const MAP_LINK_INPUT_MAX = 2048;

/** Admin bulk restaurant import (批量导入). */
export const BULK_IMPORT = {
  /** Non-blank lines accepted in one paste, and rows in one import request. */
  maxRows: 100,
  /** Rows kept in the browser queue, including already-imported read-only rows. */
  maxQueue: 200,
  /** Longest paste accepted at once (100 maximum-length lines plus line breaks). */
  maxPasteChars: 100 * (MAP_LINK_INPUT_MAX + 2),
  /** Link previews requested at the same time. */
  resolveConcurrency: 2,
  /** Body limit of the import route only, including UTF-8 text in up to 100 valid rows. */
  requestBytes: 1024 * 1024,
} as const;

/**
 * Optional region lookup (地区识别) through a Nominatim-compatible reverse geocoder. The public
 * OpenStreetMap service is used only as its usage policy allows: user-triggered, admin-only, at
 * most one request per second across the whole app, identified, cached and attributed.
 */
export const GEO = {
  defaultBaseUrl: 'https://nominatim.openstreetmap.org',
  policyUrl: 'https://operations.osmfoundation.org/policies/nominatim/',
  /** Minimum time between the starts of two requests (one shared queue for every listener). */
  minIntervalMs: 1100,
  timeoutMs: 10_000,
  maxResponseBytes: 64 * 1024,
  /** Requests waiting in the queue (beyond this the lookup answers "busy, try later"). */
  maxPending: 20,
  /** Successful answers (including "nothing here") are reused for this long, also across restarts. */
  cacheDays: 90,
  /** City-level detail; coordinates are rounded to 5 decimals (~1 m) for the cache key. */
  zoom: 10,
  language: 'en',
  baseUrlMax: 300,
} as const;

/** Link previews per 10 minutes: one 100-row batch plus retries, still bounded. */
export const MAP_LINK_RATE_LIMIT = 150;

const MANUAL_SHOPPING_ITEMS = 50;

/** Shared shopping checklist of a home meal (采购清单): manual additions per meal. */
export const SHOPPING_LIMITS = {
  /** Manual additions per meal. */
  manualItems: MANUAL_SHOPPING_ITEMS,
  name: 40,
  /** Free text, never converted or summed. */
  quantity: 60,
  note: 160,
  /** Longest group key accepted in a request (keys are normalized ingredient names). */
  groupKey: 200,
  /** Keys in one "家里已有" batch: every possible group of the largest meal (dishes × rows + manual items). */
  batchKeys: LIMITS.maxDishesPerMeal * DISH_LIMITS.ingredients + MANUAL_SHOPPING_ITEMS,
} as const;

/** Ingredients the browser remembers as "already at home" (本机现有食材). Local only, never sent as a whole. */
export const PANTRY_LIMITS = {
  /** Names kept on one device. */
  names: 100,
  /** One name, after trimming and collapsing whitespace (same as a recipe ingredient name). */
  name: DISH_LIMITS.ingredientName,
  /** Longest paste accepted in one go (never truncated: longer input is refused with a message). */
  pasteChars: 8000,
} as const;

/** Length of a calendar event exported from a timed meal (all-day meals take the whole day). */
export const CALENDAR_EVENT_MINUTES = 60;

/** Foreground refetch interval of a saved meal's shopping list (cross-device sharing is pull-based). */
export const SHOPPING_REFRESH_MS = 30_000;
