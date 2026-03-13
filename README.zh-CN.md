> **注意：** 本文档由英文版自动翻译而来，可能包含翻译错误。如需最准确的信息，请参阅 [README.md](README.md)。

# ShyTalk

**语音聊天室，重新定义。**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.0.21-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## 关于

ShyTalk 是一款社交语音聊天应用，用户可以创建和加入实时语音聊天室。基于 Kotlin Multiplatform（KMP）构建，同时支持 Android 和 iOS 平台，共享同一套代码。无论你想主持一场对话、旁听讨论，还是与世界各地的人建立联系，ShyTalk 都能让这一切变得轻松简单。

## 功能特性

### 语音聊天室
- 基于 LiveKit 技术，创建或加入实时语音房间
- 结构化的座位系统，支持房主、主持人和听众等角色
- 上座申请与邀请——申请上座发言或邀请听众参与
- 悬浮窗——在浏览应用其他部分时继续语音聊天
- 房间过期机制——房主离开后自动关闭房间，带有倒计时提示

### 消息系统
- 在每个房间中同步进行文字聊天
- 一对一私信功能
- 群聊功能，支持成员管理与权限设置
- 实时输入状态提示
- 表情贴纸支持

### 社交功能
- 自定义用户资料，包括头像、封面图片、国旗标识和个人简介
- 关注系统——关注其他用户，查看其在线状态
- 礼物墙——展示收到的礼物
- 拉黑系统——在房间和个人资料页面屏蔽用户

### 虚拟经济
- 基于金币的经济系统，含钱包和交易记录
- 每日登录奖励，连续登录有额外加成
- 幸运转盘（抽奖）系统，设有多个奖品等级
- 虚拟礼物——在语音聊天中发送和接收动画礼物
- 背包系统，用于存放礼物
- 金币商城，可购买金币套餐
- 广播横幅，附带动画礼物特效

### 账户与身份
- 多提供商认证——支持 Google、Apple 或邮箱（OTP）登录
- 将多种登录方式关联到同一账户
- 稳定的用户身份（uniqueId），跨 Firebase 项目持久化
- 设置中的关联账户管理，支持关联/取消关联操作
- 设备绑定——每台设备永久绑定到一个账户

### 管理与安全
- 管理工具——作为房主可以禁言、踢出、调换座位和管理主持人
- 用户举报系统及审核流程
- 警告与封禁机制
- 社区准则、隐私政策和服务条款页面
- 新用户法律条款确认流程
- 强制更新机制，确保用户使用最新版本

### 日志与监控
- 横跨 Express API、移动应用和管理面板的结构化日志
- 管理后台支持实时日志流
- 设备和网络封禁，支持自动执行
- 关键错误和异常的告警系统
- Trace ID 传播，实现端到端的请求追踪

## 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **架构** | MVVM + Repository 模式 |
| **依赖注入** | Koin |
| **认证** | Firebase Authentication（Google、Apple、邮箱+OTP）多提供商身份系统 |
| **数据库** | Cloud Firestore |
| **实时通信** | Firebase Realtime Database |
| **存储** | Cloudflare R2（通过 Express API 代理） |
| **API 服务器** | Express.js（Oracle Cloud 免费层） |
| **语音** | LiveKit |
| **推送通知** | Firebase Cloud Messaging |
| **图片加载** | Coil 3 (KMP) |
| **动画** | Lottie Compose |
| **日期/时间** | kotlinx-datetime |
| **导航** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## 架构

ShyTalk 遵循 **MVVM** 架构，采用清晰的 **Repository 模式**：

```
+---------------------------------------------+
|                   UI 层                      |
|  Compose 界面 -> ViewModels -> UI 状态        |
+---------------------------------------------+
|                  领域层                       |
|            Repository 接口                    |
+---------------------------------------------+
|                  数据层                       |
|  Repository 实现 -> Firestore / R2 / RTDB / LiveKit  |
+---------------------------------------------+
```

- **shared 模块**（`commonMain`）——跨平台共享的模型、Repository 接口、ViewModel 和 UI
- **app 模块** ——Android 特定的界面、Repository 实现和入口
- **iosApp 模块** ——iOS 特定的入口
- **express-api** ——运行在 Oracle Cloud 免费层上的 Express.js 后端

## 项目结构

```
ShyTalk/
+-- app/                              # Android 应用模块
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # 应用入口
|       |   +-- MainActivity.kt       # 主 Activity
|       |   +-- core/
|       |   |   +-- di/               # Koin 依赖注入模块
|       |   |   +-- room/             # ActiveRoomManager 和 RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit 语音、在线状态、通知
|       |   |   +-- repository/       # Repository 实现
|       |   +-- feature/
|       |   |   +-- auth/             # Google 登录界面
|       |   |   +-- profile/          # 个人资料界面
|       |   |   +-- room/             # 房间界面
|       |   |   +-- settings/         # 应用设置
|       |   +-- navigation/           # 导航图和路由
|       +-- test/                     # 单元测试
|       +-- androidTest/              # 端到端测试（Compose UI Test）
+-- shared/                           # KMP 共享模块
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # 共享 Koin 模块
|       |   +-- model/                # 数据模型（User、ChatRoom、Gift 等）
|       |   +-- ui/                   # 共享组件
|       |   +-- util/                 # 工具类和常量
|       +-- data/
|       |   +-- remote/               # VoiceService、TokenService 等
|       |   +-- repository/           # Repository 接口
|       +-- feature/                  # 共享功能模块
+-- iosApp/                           # iOS 应用模块
+-- express-api/                      # Express.js API 服务器
|   +-- src/
|       +-- routes/                   # API 路由处理
|       +-- middleware/               # 认证、日志中间件
|       +-- utils/                    # Firebase Admin、R2、日志工具
|       +-- cron/                     # 定时任务
+-- public/                           # 静态网站和管理面板
+-- firestore.rules                   # Firestore 安全规则
+-- database.rules.json               # RTDB 安全规则
+-- firestore.indexes.json            # Firestore 复合索引
+-- firebase.json                     # Firebase 配置
```

## 快速开始

### 前置条件

- **Android Studio** Ladybug 或更新版本
- **Firebase 项目**（Spark 免费计划）——Auth、Firestore、RTDB、FCM
- **LiveKit Cloud 账号**（免费层）
- **Cloudflare 账号**（免费）——R2 存储、Pages 托管
- **Oracle Cloud 账号**（免费层）——Express API 托管
- **Node.js 18+**，用于 Express API
- **JDK 17+**

### 配置步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   ```

2. **Firebase 配置**
   - 在 [console.firebase.google.com](https://console.firebase.google.com) 创建 Firebase 项目
   - 在认证部分启用 **Google 登录** 和 **Apple 登录**
   - 启用 **Firestore**、**Realtime Database** 和 **Cloud Messaging**
   - 下载 `google-services.json` 并放置于 `app/` 目录

3. **Express API 配置**
   ```bash
   cd express-api
   cp .env.example .env  # 编辑并填入你的凭据
   npm install
   npm start
   ```

4. **部署 Firestore 安全规则**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

5. **构建 Android 应用**
   ```bash
   ./gradlew assembleDebug
   ```

### 环境变量

| 变量 | 说明 | 使用位置 |
|------|------|----------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK 服务账号 JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 账号 ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 访问密钥 | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 密钥 | Express API |
| `R2_BUCKET_NAME` | R2 存储桶名称（默认：`shytalk-media`） | Express API |
| `LIVEKIT_API_KEY` | LiveKit API 密钥 | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API 密钥 | Express API |
| `LIVEKIT_URL` | LiveKit 服务器 URL | Android 应用（BuildConfig） |
| `WORKER_URL` | Express API 基础 URL | Android 应用（BuildConfig） |

## 测试

```bash
# Android/KMP 单元测试
./gradlew test

# Express API 测试
cd express-api && npm test

# 端到端测试（需要连接设备或模拟器）
./gradlew connectedDebugAndroidTest
```

## 部署

- **Express API：** 通过 `scp` + PM2 部署到 Oracle Cloud 虚拟机
- **Android：** 执行 `./gradlew bundleRelease`，然后上传至 Google Play
- **管理面板：** `npx wrangler pages deploy public --project-name shytalk-site`

## 参与贡献

欢迎贡献代码！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献指南。

## 许可证

本项目基于 Apache License 2.0 开源。详情请参阅 [LICENSE](LICENSE)。

## 致谢

- [Firebase](https://firebase.google.com) —— 认证、Firestore、Realtime Database、云消息推送
- [LiveKit](https://livekit.io) —— 实时语音通信
- [Cloudflare](https://www.cloudflare.com) —— R2 存储、Pages 托管、CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) —— 免费层虚拟机，用于 Express API
- [Express.js](https://expressjs.com) —— API 服务器框架
- [Jetpack Compose](https://developer.android.com/jetpack/compose) —— 现代声明式 UI 框架
- [Koin](https://insert-koin.io) —— 轻量级依赖注入
- [Coil](https://coil-kt.github.io/coil/) —— Kotlin Multiplatform 图片加载库
- [Lottie](https://airbnb.design/lottie/) —— 动画礼物和 UI 效果
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) —— 跨平台日期时间处理
