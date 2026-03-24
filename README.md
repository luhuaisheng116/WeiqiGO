# 网页围棋双人联机 MVP

一个最小可用版本的双人联机围棋网页游戏，优先实现：

- 两个人进入同一房间
- 棋盘实时同步
- 正确轮流落子
- 基本提子规则
- 简洁可用的页面

当前暂不包含：

- 人机对战
- 登录注册
- 数据库持久化
- 排位系统
- 复杂打劫判断
- 观战模式

## 启动

```bash
npm.cmd install
npm.cmd start
```

启动后打开：

```text
http://localhost:3000
```

两个人输入相同房间号即可开始。

也可以直接通过 URL 指定房间：

```text
http://localhost:3000/?room=demo-room
```

## 说明

- 默认使用 9 路棋盘，便于快速联机验证
- 第一个进入房间的是黑方，第二个进入的是白方
- 必须两位玩家都进入后才允许开始落子
- 支持基础提子与自杀棋禁止
- 暂未实现打劫判定与终局数子

## 部署成公网网址

这个项目已经补好了 Render 部署配置文件 [render.yaml](/d:/codex/go-mvp/render.yaml)。

### 方式一：最省事

1. 把 [go-mvp](/d:/codex/go-mvp) 上传到 GitHub 仓库
2. 登录 Render
3. 选择 `New +` -> `Blueprint`
4. 选择你的 GitHub 仓库
5. Render 会识别 `render.yaml` 并自动创建服务
6. 部署完成后，你会得到一个 `https://xxx.onrender.com` 的网址

### 方式二：手动创建 Web Service

如果不走 Blueprint，也可以在 Render 里手动创建：

- Runtime: `Node`
- Root Directory: `go-mvp`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`

### 部署后使用

- 打开 Render 分配的网址
- 两位玩家访问同一个网址
- 输入相同房间号即可联机

### 注意

- 当前房间状态保存在服务内存里，服务重启后房间会清空
- 这是 MVP，所以适合演示、测试和小范围使用
- 暂未加入数据库、断线重连恢复和复杂打劫规则
