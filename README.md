# Love Letter 情書網頁版

## 立即遊玩

點這裡就可以玩：<https://frankkn.github.io/love-letter/>

這是一款使用 TypeScript、Vite 與原生 DOM 製作的《情書 Love Letter》網頁遊戲，支援單機 AI 對戰、多人連線大廳、手機版介面與 PWA 安裝。

## 版本資訊

### v1.1.0 - UI 體驗更新

- 重構手機版戰場配置，讓 1 到 3 名電腦玩家時都能使用更一致的橫向區域。
- 調整玩家與電腦區域比例，讓手牌區、棄牌區與提示文字在手機上更好閱讀。
- 改善卡牌提示文字位置，減少多張棄牌時的重疊問題。
- 補強男爵與國王效果的彈窗資訊，玩家對電腦時也能查看雙方手牌。
- 優化卡牌名稱、點數與描述層級，讓手機版卡牌資訊更清楚。

### v1.0.0 - 初版發布

- 完成《情書 Love Letter》核心規則與 8 種角色卡效果。
- 支援玩家與 1 到 3 名電腦 AI 進行單機對戰。
- 加入多人連線大廳、房間建立、加入房間與準備流程。
- 實作 AI 記憶與基礎策略判斷，讓電腦玩家能依已知資訊出牌。
- 支援手機版介面、出牌統計、對戰紀錄與 PWA 安裝。

## 目前功能

- 單機模式
  - 支援 2 到 4 人局。
  - 玩家可與 1 到 3 名電腦 AI 對戰。
  - 完整實作 8 種情書卡牌效果：衛兵、神父、男爵、侍女、王子、國王、伯爵夫人、公主。

- 多人連線模式
  - 使用 Colyseus 實作房間大廳與等待室。
  - 支援創建房間、加入房間、準備狀態、房主開始遊戲。
  - 遊戲開始後會同步初始牌局資料，讓所有玩家進入同一場戰局。

- AI 邏輯
  - AI 會記憶神父、國王交換、男爵平手等資訊。
  - 衛兵會優先使用已知資訊猜牌。
  - AI 會避免明顯自殺式出牌，例如王子丟自己公主、男爵拿低牌去撞已知高牌。

- 手機版 UI
  - 針對直向手機螢幕重構戰場比例。
  - 出牌統計改為懸浮按鈕。
  - 對戰紀錄改為彈窗檢視，釋放主畫面空間。
  - 卡牌提示文字與卡牌綁在同一個垂直容器中，避免提示字重疊。

- PWA
  - 支援 `manifest.json` 與 `sw.js`。
  - 可在 Android Chrome / iOS Safari 加入主畫面，以近似 App 的方式開啟。

## 技術棧

- TypeScript
- Vite
- Vanilla DOM
- CSS Grid / Flexbox
- Colyseus
- Playwright
- PWA

## 專案結構

```text
.
├── index.html
├── package.json
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── src/
│   ├── main.ts
│   ├── style.css
│   ├── assets/cards/
│   └── server/
│       ├── index.ts
│       ├── rooms/
│       └── schema/
├── tests/
└── vite.config.ts
```

## 本機開發

安裝依賴：

```bash
npm install
```

啟動前端開發伺服器：

```bash
npm run dev
```

預設網址：

```text
http://localhost:5173
```

建置前端：

```bash
npm run build
```

預覽 production build：

```bash
npm run preview
```

## Colyseus 後端

建置後端：

```bash
npm run build:server
```

啟動後端：

```bash
npm run start:server
```

部署到 Render 時，請確認環境變數與前端 Colyseus endpoint 設定正確。

## 測試

執行 Playwright 測試：

```bash
npm run test:e2e
```

## 遊戲目標

每一局中，玩家透過出牌效果淘汰對手，或在牌堆抽完時以手牌點數最高者獲勝。先取得 4 枚硬幣的玩家成為總冠軍。
