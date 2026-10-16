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
  /** Custom text for a restaurant's external link button. */
  linkLabel: 20,
  maxDishesPerMeal: 30,
  maxCandidates: 20,
  uploadBytes: 20 * 1024 * 1024,
  maxInputPixels: 60_000_000,
  fullEdge: 1600,
  thumbEdge: 480,
} as const;

/** Button text for a restaurant's external link when no custom label is set. */
export const DEFAULT_LINK_LABEL = '查看链接';

export const MEAL_SUGGESTIONS = ['早午餐', '午餐', '晚餐', '下午茶', '夜宵'] as const;

/** Attempts per recipient device (each device retries independently). */
export const NOTIFY_MAX_ATTEMPTS = 5;

export const BARK_LIMITS = {
  maxDevices: 10,
  label: 30,
} as const;

/** Longest pasted text/link accepted by the Google Maps link importer. */
export const MAP_LINK_INPUT_MAX = 2048;
