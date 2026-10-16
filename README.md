# Bistro Express

两个人的私人点餐小馆：一方提交每一餐想吃什么（在家做 / 去餐厅），主厨维护菜品与餐厅，并通过 Bark 收到新建、修改、取消的推送。

- 前端：React + Vite + TypeScript（`/bistro/` 子路径，PWA）
- 后端：Hono on Node，SQLite（better-sqlite3），单容器双监听
  - `3000` 公开监听：只提供访客界面与访客 API，所有 `/bistro/admin*`、`/bistro/api/admin*` 一律 404
  - `3001` 内部监听：管理后台 + 访客功能，仅发布到 `127.0.0.1:8787`
- 数据：`./data`（SQLite + 图片），不进 git；没有备份功能

## 首次部署

```bash
# 1. 生成 .env（入口日期与管理密码只以 scrypt 哈希保存）
PUBLIC_BASE_URL=https://share.zihoh.com/bistro \
ADMIN_BASE_URL=https://whitepc.tail913bc.ts.net:8788/bistro \
npm run setup            # 按提示输入入口日期（YYYY-MM-DD），也可用 BISTRO_ENTRY_DATE=… 或 stdin 传入

# 生成的管理密码在 secrets/admin-password.txt（权限 600，已 gitignore），读取后可自行删除

# 2. 构建并启动（需要已存在的外部网络 1panel-network）
docker compose up -d --build
docker compose ps        # 健康检查：/bistro/api/health
```

反向代理：公开站点把 `/bistro/` 转发到 `bistro-express:3000`（示例见 `ops/nginx-location.conf`）；管理入口把私有 HTTPS 地址转发到 `127.0.0.1:8787`。

## 日常运维

```bash
docker compose logs -f bistro-express          # 查看日志
docker compose up -d --build                    # 更新代码后重新部署（启动时自动执行数据库迁移）
docker compose restart bistro-express           # 重启
npm run setup -- --rotate-admin                 # 重新生成管理密码，之后重启容器
BISTRO_ENTRY_DATE=YYYY-MM-DD npm run setup      # 修改入口日期，之后重启容器
```

首次进入后台后：在「推送设置」里填写 Bark 设备 Key 并发送测试推送；在「菜品」「餐厅」添加内容（初始目录为空）。未配置推送时，通知会显示为「通知未配置」，配置后可在「通知」页一键重试。

## 本地开发

```bash
npm install
# 在 .env 中使用 localhost 地址：
#   PUBLIC_BASE_URL=http://localhost:3100/bistro
#   ADMIN_BASE_URL=http://localhost:5173/bistro
#   PUBLIC_PORT=3100  ADMIN_PORT=3101  COOKIE_SECURE=false  DATA_DIR=./data
npm run dev        # Vite :5173（代理 API 到内部监听 :3101）+ 后端热重载
npm run typecheck
npm test           # Vitest：使用临时数据库/目录与假推送，不会真实推送
npm run build && node --env-file=.env dist/server/server/index.js
```

## 安全要点

- 访客：输入正确日期后获得 30 天会话；管理：密码登录，会话 8 小时。令牌随机生成、仅哈希存库，Cookie 为 `HttpOnly; Secure; SameSite=Lax; Path=/bistro`
- 登录与日期验证有按客户端 + 全局的失败次数限制；所有写请求校验 `Origin`
- 菜单、计划、图片都需要会话；Service Worker 只缓存公开外壳与静态资源，从不缓存 API/图片
- 上传支持 JPEG/PNG/WebP/HEIC，统一转为去除 EXIF 的 WebP（长边 1600 + 480 缩略图），不接受 SVG
- `.env`、`data/`、`secrets/` 均已 gitignore；`.env.example` 只含占位值

## whitepc 当前入口

- 前台：<https://share.zihoh.com/bistro/>
- 管理后台（先连接 Tailscale）：<https://whitepc.tail913bc.ts.net:8788/bistro/admin>
- NPM 的现有 `share.zihoh.com` HTTPS 站点包含 `/data/nginx/custom/bistro-express.locations.conf`，内容来自 `ops/nginx-location.conf`。更新片段后先执行 `nginx -t`，通过后再平滑重载。
- Tailscale 私有代理：`tailscale serve --bg --https=8788 http://127.0.0.1:8787`，保留其他 Serve 端口。
- 正式数据在 `data/`，初始管理密码在 `secrets/admin-password.txt`；两者均排除出 Git 和镜像构建上下文。
