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

首次进入后台后：在「推送设置」里打开总开关、添加 Bark 设备并发送测试推送；在「菜品」「餐厅」添加内容（初始目录为空）。未配置推送时，通知会显示为「通知未配置」，配置后可在「通知」页一键重试。

升级到多设备版本时，启动会自动执行数据库迁移 2：旧的单个设备 Key 会变成一台名为「原设备（旧版单设备设置）」的设备（总开关与服务器地址保持不变），已有通知记录原样保留。`.env` 不需要改动。

## 功能说明

### 首页选日期

- 日期条只显示最近 7 天（今天、明天……），有安排的日子带小圆点。
- 「选择日期」按钮打开站内月历（手机上是底部弹层），不依赖系统日期控件：周一开头，可上/下个月、按年份/月份跳转、直接输入日期（如 `2027-03-05`、`2027年3月5日`），「回到今天」一键返回。
- 过去的日子不可选（历史计划在「历史」页查看）；所有即将到来的有效计划日期都会在月历上标记，不再只标前 10 天。
- 键盘：方向键按天/周移动，Home/End 到周一/周日，PageUp/PageDown 换月（加 Shift 换年），Enter 选择，Esc 关闭。
- 选中 7 天以外的日期时，日期会显示在「选择日期」按钮上，下方列表和「加一餐」都使用该日期。

### 餐厅：从 Google 地图链接填写（仅后台）

在「添加餐厅」里粘贴 Google 地图分享链接，点「识别链接」，结果只会填进表单，**不会自动创建餐厅**；核对后仍需点「保存」。

- 不使用任何 API Key 或付费 Places API，只解析链接本身：`/maps/place/<店名>`、`q`/`query`、`query_place_id`、`cid`、`ftid`、`data=` 里的 `!1s` 地点编号和 `!3d…!4d…` 店铺坐标（区分 `@lat,lng` 地图视角中心）。
- `maps.app.goo.gl`、`goo.gl/maps` 短链接由服务器展开：只允许 https 的 Google 地图主机，拒绝用户名/端口/IP/localhost，逐跳校验、最多 5 次跳转、总超时 8 秒，不读取网页内容。只请求短链接（以及完全不含地点信息的 `maps.google.com/maps?…` 旧链接），跳到 `www.google.com/maps/…` 后直接解析、不再请求；每 10 分钟最多识别 30 次。
- **能填的只有店名和地图链接**（跟踪参数会被去掉；也可改用原始短链接）。地址、菜系、预算、照片、评分、营业时间都不会自动获取——Google 分享页面本身不提供这些（实测标题只是「Google Maps」），请手动填写。
- 已经手动输入的店名/链接不会被覆盖，需要点「用识别结果替换」才会替换。
- 若链接里的地点编号（CID/FTID/Place ID）或原链接与已有餐厅相同，会提示「可能已经添加过」；同一品牌的不同分店不会被当成重复。旧餐厅保存的短链接不会被展开，只能按链接本身比对。
- 识别失败（短链接失效、跳转到 Google 同意/登录页、网络问题）时，粘贴的链接会保留，可继续手动填写。

### Bark 多设备推送

- 「推送设置」里有总开关和共用的 Bark 服务器地址（默认 `https://api.day.app`，可填自建服务器），以及最多 10 台设备：名称、打码的 Key、单独启用/暂停、编辑、删除、单台测试和「测试全部启用的设备」。
- Key 只存在服务器私有 SQLite 中，任何接口、日志和错误信息都只显示打码后的 Key；同一个 Key 不能重复添加（也可以粘贴 `https://api.day.app/<key>/…` 整段地址）。
- 每次新建/修改/取消计划，所有启用的设备都会收到同一条推送。每台设备单独记录送达结果、单独重试（最多 5 次）：一台失败不会让已送达的设备重复收到。
- 重试期间停用或删除的设备会被标记为「已跳过」；事件发生后才添加的设备不会收到这条旧通知的重试。只有完全没送达任何设备的通知（例如当时未配置），手动重试时才会发给当前启用的设备。
- 只要有设备没收到，通知就不会显示为全部送达：访客看到「部分送达（1/2 台设备）」，后台「通知」页逐台显示设备名、状态、尝试次数和错误。计划被再次修改时，旧版本未送出的推送会被新版本取代。
- 服务重启时正在发送的那一台设备可能收到重复推送（每条都带编号和版本号）。

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

容器同时连接 NPM 的共享网络和项目专用的 bistro-express-outbound 网桥。默认外连走专用网桥，供 Google Maps 短链接解析及 Bark 推送使用；公开入口仍通过 NPM，后台端口仍只绑定本机回环。Compose 需要支持 gw_priority（2.33.1 或更新版本）。
