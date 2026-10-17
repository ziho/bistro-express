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

export const MEAL_SUGGESTIONS = ['早午餐', '午餐', '晚餐', '下午茶', '夜宵'] as const;

/** Attempts per recipient device (each device retries independently). */
export const NOTIFY_MAX_ATTEMPTS = 5;

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

/** Link previews per 10 minutes: one 100-row batch plus retries, still bounded. */
export const MAP_LINK_RATE_LIMIT = 150;
