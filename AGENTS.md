# AGENTS.md

## 项目概览
喂奶记录（Feed Log）- 一个极简的宝宝喂奶时间记录工具，支持家人通过房间码共享记录。核心设计原则：操作步骤最少，单手可操作。

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + 自定义样式（Tailwind CSS 4）
- **Database**: SQLite (better-sqlite3)
- **Styling**: Tailwind CSS 4，自定义暖色主题

## 构建与运行
```bash
pnpm install          # 安装依赖
pnpm run dev          # 开发环境（端口 5000，HMR）
pnpm run build        # 构建生产版本
pnpm run start        # 生产环境
```

## 目录结构
```
src/
├── app/
│   ├── api/
│   │   ├── rooms/route.ts          # POST 创建/加入房间
│   │   ├── rooms/[id]/route.ts     # GET 房间详情+喂奶记录
│   │   ├── rooms/[id]/feeds/route.ts  # POST 添加记录 / GET 获取记录
│   │   └── feeds/[feedId]/route.ts    # PUT 更新记录 / DELETE 删除记录
│   ├── layout.tsx                  # 根布局
│   ├── page.tsx                    # 主页面（喂奶记录界面）
│   └── globals.css                 # 全局样式
├── storage/database/
│   ├── sqlite.ts                   # SQLite 初始化与查询仓储
│   └── time.ts                     # 中国时区记录周期计算
└── components/ui/                  # shadcn/ui 组件库
```

## 数据库 Schema
- **rooms**: 房间表（id, code[唯一6位码], name, created_at）
- **feed_records**: 喂奶记录（id, room_id[外键], feeder_name, feed_type, duration_minutes, amount_ml, note, started_at, created_at）
- feed_type 取值：left / right / bottle / formula
- 数据库文件默认位于 `data/baby-feed.sqlite`，可通过 `SQLITE_PATH` 覆盖
- 服务端 API 负责所有读写，SQLite 外键级联删除保持房间数据一致性

## 代码风格
- 数据库字段名统一 snake_case，与 API 返回字段保持一致
- SQLite 查询集中在 `src/storage/database/sqlite.ts`，API 路由不直接管理连接
- 组件使用 'use client' 标注客户端组件
- 禁止在 JSX 中直接使用 typeof window / Date.now() 等动态数据
- CSS 内联样式用于主题色，Tailwind 用于布局

## 设计规范
- 详见 DESIGN.md：暖奶白色背景、柔和珊瑚主色、大按钮、单手操作
