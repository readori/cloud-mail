<p align="center">
    <img src="doc/demo/logo.png" width="80px" />
    <h1 align="center">Cloud Mail</h1>
    <p align="center">基于 Cloudflare 的简约响应式邮箱服务，支持邮件发送、附件收发 🎉</p> 
    <p align="center">
        简体中文 | <a href="/README.md" style="margin-left: 5px">English </a>
    </p>
    <p align="center">
        <a href="https://github.com/maillab/cloud-mail/tree/main?tab=MIT-1-ov-file" target="_blank" >
            <img src="https://img.shields.io/badge/license-MIT-green" />
        </a>    
        <a href="https://github.com/maillab/cloud-mail/releases" target="_blank" >
            <img src="https://img.shields.io/github/v/release/maillab/cloud-mail" alt="releases" />
        </a>  
        <a href="https://github.com/maillab/cloud-mail/issues" >
            <img src="https://img.shields.io/github/issues/maillab/cloud-mail" alt="issues" />
        </a>  
        <a href="https://github.com/maillab/cloud-mail/stargazers" target="_blank">
            <img src="https://img.shields.io/github/stars/maillab/cloud-mail" alt="stargazers" />
        </a>  
        <a href="https://github.com/maillab/cloud-mail/forks" target="_blank" >
            <img src="https://img.shields.io/github/forks/maillab/cloud-mail" alt="forks" />
        </a>
    </p>
    <p align="center">
        <a href="https://trendshift.io/repositories/20459" target="_blank" >
            <img src="https://trendshift.io/api/badge/repositories/20459" alt="trendshift" >
        </a>
    </p>
</p>

> [!IMPORTANT]
> 本项目基于 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 修改,主要变更:
> - **增强 Cloud Mail 后端**: 邮件 API、CC/BCC、通知与安全性改进
> - **新功能**: 适配iOS客户端 CF Mail
> - **[CloudMail 部署文档](https://cfmail.readori.com/cloudmail-cloudflare-deploy-guide)
> - ** <a href="/doc/CloudMail-Self-Hosting-Deployment-Guide-ZH.md" style="margin-left: 5px"> CloudMail邮箱自建教程 </a>
## 项目简介

只需要一个域名，就可以创建多个不同的邮箱，类似各大邮箱平台，本项目支持署到 Cloudflare Workers ，降低服务器成本，搭建自己的邮箱服务

## 项目展示

- [在线演示](https://skymail.ink)<br>
- [部署文档](https://doc.skymail.ink)<br>
- [CloudMail 部署文档](https://cfmail.readori.com/cloudmail-cloudflare-deploy-guide)<br>

| ![](/doc/demo/demo1.png) | ![](/doc/demo/demo2.png) |
|-----------------------|-----------------------|
| ![](/doc/demo/demo3.png) | ![](/doc/demo/demo4.png) |




## 功能介绍

- **💰 低成本使用**： 可部署到 Cloudflare Workers 降低服务器成本

- **💻 响应式设计**：响应式布局自动适配PC和大部分手机端浏览器

- **📧 邮件发送**：集成Cloudflare Email Service或Resend发送邮件，支持群发，内嵌图片和附件发送，发送状态查看

- **🛡️ 管理员功能**：可以对用户，邮件进行管理，RABC权限控制对功能及使用资源限制

- **📦 附件收发**：支持收发附件，使用R2对象存储保存和下载文件

- **🔔 邮件推送**：接收邮件后可以转发到TG机器人或其他服务商邮箱

- **📡 开放API**：支持使用API批量生成用户，多条件查询邮件 

- **🔢 验证码识别**：使用Workers AI，自动识别邮件验证码 

- **📈 数据可视化**：使用ECharts对系统数据详情，用户邮件增长可视化显示

- **🎨 个性化设置**：可以自定义网站标题，登录背景，透明度

- **🤖 人机验证**：集成Turnstile人机验证，覆盖注册、添加邮箱，并可选开启登录验证

- **⚡ 实时收信**：基于 WebSocket(Durable Object)实时推送新邮件，断线自动轮询兜底

- **🖼️ 图片隐私代理**：正文外链图片经签名同源代理加载并过滤追踪像素，不向发件人暴露阅读者 IP

- **📜 更多功能**：正在开发中...



## 最新更新

### 2026-11 · Cloudflare Email Service 发信

- **Cloudflare Email Service 发信**：外发邮件除 Resend 外，可通过 Cloudflare `send_email` 绑定(Email Sending)发送。
- **发信服务选择**：管理员可在发信设置中选择 `auto`(自动)、`cloudflare` 或 `resend`。自动模式(默认)优先使用 Cloudflare；发件域名配置了 Resend Token 时，Cloudflare 拒收(如域名尚未接入、套餐限制收件人)会自动回退 Resend。
- **错误提示**：Cloudflare 错误码(如 `E_SENDER_NOT_VERIFIED`、`E_RECIPIENT_PLAN_RESTRICTED`)会附带简要的修复提示。
- **管理员测试发信**：在管理后台发送测试邮件，确认当前生效的发信方式。
- **发信绑定配置**：`mail-worker/wrangler.toml` 已声明 `email` send_email 绑定；使用 GitHub Actions 部署时，将仓库变量 `CLOUDFLARE_EMAIL` 设为 `true` 即会声明该绑定。

### 2026-11 · 同步上游 cloud-mail v3.6.0

- **实时推送新邮件**：收件箱和管理员「全部邮件」通过 WebSocket(`/realtime`，`MailHub` SQLite Durable Object)即时刷新；连接使用 HttpOnly 会话 Cookie 鉴权并校验来源，断线时网页端按「自动刷新」间隔轮询兜底。
- **签名图片代理**：正文外链图片改写为 `/proxy?url=…`(HMAC 签名、1 小时有效、过滤追踪像素)，阅读时不向发件人暴露 IP；回复、转发和发信前自动还原为原始链接。
- **登录人机验证**：系统设置新增「登录验证」，可选每次验证、关闭(默认)或同一 IP 当天登录达到次数后验证。
- **会话安全**：本人修改密码后保留当前会话、其它设备全部下线；令牌增加鉴权代际。
- **转发增强**：站内用户之间的邮件同样触发实时推送和转发(Telegram、Webhook、`forward` 邮件路由绑定)；转发规则按用户登录邮箱或收件地址匹配，Webhook 也遵循同一规则。
- **全部邮件搜索**：管理员可按用户、账号、发件人、收件人、主题、正文搜索全站邮件，并按日期筛选。
- **安全加固**：附件响应按安全类型与下载方式返回以防 XSS；单封外发最多 50 个收件人；非中文客户端返回英文提示。
- **Telegram 转发精简**：一封邮件只发一条消息（没有「View」按钮时最多 3 条）；链接显示为可点击文字而不是超长追踪网址，图片和隐藏预览文本不再出现，正文内嵌图片也不再逐个作为文件发送。
- **自动创建管理员**：配置可选的 `ADMIN_PASSWORD` Secret 后，执行 `/init` 时若 `ADMIN` 账号不存在会自动创建。

**升级说明**：请用 `deploy-and-migrate` 模式运行一次部署工作流，以补齐登录验证相关字段和索引；部署配置已新增 `ws` Durable Object 绑定(含 `v1` 迁移)和 `forward` 邮件发送绑定。

**问题修复**：迁移 `0005_email_sender.sql` 改为可重复执行。已由 `/init` 或 Worker 运行时自动补齐 `email.sender_email` 的数据库，执行 `deploy-and-migrate` 时不再报 `duplicate column name: sender_email`。

## 技术栈

- **平台**：[Cloudflare Workers](https://developers.cloudflare.com/workers/)

- **Web框架**：[Hono](https://hono.dev/)

- **ORM：**[Drizzle](https://orm.drizzle.team/)

- **前端框架**：[Vue3](https://vuejs.org/) 

- **UI框架**：[Element Plus](https://element-plus.org/) 

- **邮件推送：** [Resend](https://resend.com/)

- **缓存**：[Cloudflare KV](https://developers.cloudflare.com/kv/)

- **数据库**：[Cloudflare D1](https://developers.cloudflare.com/d1/)

- **文件存储**：[Cloudflare R2](https://developers.cloudflare.com/r2/)

## 目录结构

```
cloud-mail
├── mail-worker				    # worker后端项目
│   ├── src                  
│   │   ├── api	 			    # api接口层			
│   │   ├── const  			    # 项目常量
│   │   ├── dao                 # 数据访问层
│   │   ├── email			    # 邮件处理接收
│   │   ├── entity			    # 数据库实体
│   │   ├── error			    # 自定义异常
│   │   ├── hono			    # web框架配置、拦截器、全局异常等
│   │   ├── i18n			    # 语言国际化
│   │   ├── init			    # 数据库缓存初始化
│   │   ├── model			    # 响应体数据封装
│   │   ├── security			# 身份权限认证
│   │   ├── service			    # 业务服务层
│   │   ├── template			# 消息模板
│   │   ├── utils			    # 工具类
│   │   └── index.js			# 入口文件
│   ├── pageckge.json			# 项目依赖
│   └── wrangler.toml			# 项目配置
│
├── mail-vue				    # vue前端项目
│   ├── src
│   │   ├── axios 			    # axios配置
│   │   ├── components			# 自定义组件
│   │   ├── echarts			    # echarts组件导入
│   │   ├── i18n			    # 语言国际化
│   │   ├── init			    # 入站初始化
│   │   ├── layout			    # 主体布局组件
│   │   ├── perm			    # 权限认证
│   │   ├── request			    # api接口
│   │   ├── router			    # 路由配置
│   │   ├── store			    # 全局状态管理
│   │   ├── utils			    # 工具类
│   │   ├── views			    # 页面组件
│   │   ├── app.vue			    # 入口组件
│   │   ├── main.js			    # 入口js
│   │   └── style.css			# 全局css
│   ├── package.json			# 项目依赖
└── └── env.release				# 项目配置
```

## Cloudflare Email Service 发信配置

外发邮件可使用 Cloudflare Email Service(Email Sending)或 Resend。

1. 在 Cloudflare 控制台打开 **Email Service → Email Sending**，接入每个发件域名。Cloudflare 会自动添加所需的 SPF 和 DKIM 记录。
2. 部署带 `email` send_email 绑定的 Worker：手动部署时 `wrangler.toml` 已声明；使用 GitHub Actions 工作流时，将仓库变量 `CLOUDFLARE_EMAIL` 设为 `true`。
3. 在管理后台的发信设置中保持 `auto`(自动)，或明确选择 `cloudflare` / `resend`。
4. 在管理后台发送一封测试邮件，确认可以正常投递。

注意事项：

- 发给任意收件人需要 Workers 付费版。
- 自动模式仅在该域名已配置 Resend Token、且 Cloudflare 以错误码拒收(除 `E_INTERNAL_SERVER_ERROR` 外的任意 `E_*` 错误码)时回退 Resend；无错误码或内部错误不回退，避免重复发信。

## 后端安全加固说明

本版本已完成后端深度安全审计，覆盖鉴权与权限、OAuth、注册与 Turnstile、邮件与附件、D1/KV/R2/S3、Resend Webhook、APNs、初始化和敏感配置。

部署前请务必阅读 [BACKEND_SECURITY_AUDIT.md](./BACKEND_SECURITY_AUDIT.md)。升级时需要：

1. 轮换并通过 `wrangler secret put` 配置 `jwt_secret`、`init_secret`、`resend_webhook_secret` 等 Secret。
2. 使用 `POST /api/init` 和 `X-Init-Secret` 执行最新数据库迁移。
3. 重新构建并部署 `mail-vue`，以启用 OAuth state 和一次性绑定凭证。
4. 在 staging 环境验证邮件收发、Webhook、对象存储和 APNs 后再切换生产流量。

旧的 `GET /api/init/:secret` 和无签名 Resend Webhook 默认关闭，不建议重新开启。

## 许可证

本项目采用 [GPLv3](LICENSE) 许可证

## Upstream

本项目基于 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 修改
