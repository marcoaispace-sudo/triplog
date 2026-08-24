# 旅記 TripLog

個人旅行管理 PWA 互動原型，介面使用繁體中文。現階段示範旅程總覽、出發前準備、每日行程、附近景點、旅行記帳、收據／機票上傳流程及設定頁。

## GitHub Pages 發布

儲存庫已包含 `.github/workflows/pages.yml`。推送到 `main` 分支後，GitHub Actions 會自動：

1. 安裝 Node.js 22 及相依套件；
2. 執行 GitHub Pages 專用型別檢查與靜態建置；
3. 將 `out` 內容發布至 GitHub Pages。

首次使用時，在儲存庫的 **Settings → Pages → Build and deployment**，將 **Source** 設為 **GitHub Actions**。

## 本機驗證

```bash
npm ci
npm run typecheck:pages
GITHUB_REPOSITORY=your-account/triplog \
NEXT_PUBLIC_BASE_PATH=/triplog \
NEXT_PUBLIC_SITE_URL=https://your-account.github.io/triplog \
npm run build:pages
```

成功後靜態網站輸出於 `out/`。

## 目前狀態

- 原型介面及主要互動已完成。
- 已加入 PWA manifest、iPhone 主畫面圖示與離線快取。
- 上傳及自動辨認功能目前為互動示範，未接駁真實 OCR／AI API。
- 雲端同步及私人資料儲存尚未接駁 Supabase。
