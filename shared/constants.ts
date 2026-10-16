/** Public path prefix. The app is only ever served below this path. */
export const BASE_PATH = '/bistro';
export const API_PATH = `${BASE_PATH}/api`;
export const ADMIN_UI_PATH = `${BASE_PATH}/admin`;
export const ADMIN_API_PATH = `${API_PATH}/admin`;

export const APP_NAME = 'Bistro Express';

export const GUEST_COOKIE = 'bx_guest';
export const ADMIN_COOKIE = 'bx_admin';

export const GUEST_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

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
  maxDishesPerMeal: 30,
  maxCandidates: 20,
  uploadBytes: 20 * 1024 * 1024,
  maxInputPixels: 60_000_000,
  fullEdge: 1600,
  thumbEdge: 480,
} as const;

export const MEAL_SUGGESTIONS = ['早午餐', '午餐', '晚餐', '下午茶', '夜宵'] as const;

export const NOTIFY_MAX_ATTEMPTS = 5;
