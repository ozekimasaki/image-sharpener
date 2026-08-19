# Image Sharpener

ブラウザ上だけで画像を **WebP / JPEG / PNG / AVIF** に変換できる、クライアントサイド完結の画像変換ツールです。画像はサーバーへ一切アップロードされず、すべての変換処理がブラウザ内（Canvas API）で行われます。ホスティングは Cloudflare Workers（静的アセット配信）で行います。

## 主な機能

- **複数形式への変換**: WebP / JPEG / PNG / AVIF に対応。
- **品質（圧縮率）調整**: スライダーで品質を 0.1〜1.0 の範囲で設定（PNG は品質設定が無効なため自動的に `N/A` 表示）。
- **ドラッグ＆ドロップ / ファイル選択**: 複数ファイルをまとめて投入可能。
- **並列処理**: `navigator.hardwareConcurrency` に基づき最大 6 並列（`frontend/src/main.ts` の `DEFAULT_CONCURRENCY`）で変換。
- **個別 / 一括ダウンロード**: 一括ダウンロードは [fflate](https://github.com/101arrowz/fflate) で ZIP 化（`images.zip`）。
- **ブラウザ対応形式の自動検出とフォールバック**: AVIF / WebP を Canvas でエンコード試行して対応可否を判定し、未対応時は WebP または JPEG へ自動フォールバック（`frontend/src/browserCapabilities.ts`）。フォールバックが発生した場合は各アイテムに通知を表示。
- **ブラウザ対応状況の表示**: 各形式の対応可否を一覧表示。
- **失敗のみ再試行 / 設定変更時の再エンコード**: 品質・出力形式を変更すると自動で再エンコード。
- **プライバシー**: 画像はネットワーク送信されず、ブラウザ内でのみ処理されます。

## 要件

- **Node.js 20**（CI で使用しているバージョン。`.github/workflows/lint.yml` 参照）
- **npm**
- デプロイ時: Cloudflare アカウントおよび [Wrangler](https://developers.cloudflare.com/workers/wrangler/) の認証

## インストール

```bash
# リポジトリのクローン
git clone https://github.com/ozekimasaki/image-sharpener.git
cd image-sharpener

# ルートの依存関係（lint / wrangler など）
npm ci

# フロントエンドの依存関係
npm --prefix frontend ci
```

## 使い方（ローカル開発）

```bash
# フロントエンドの開発サーバーを起動（Vite）
npm --prefix frontend run dev
```

Vite が表示するローカル URL（デフォルト `http://localhost:5173`）をブラウザで開き、画像をドロップまたは選択して変換します。

本番相当のビルドをプレビューする場合:

```bash
npm run build              # frontend/dist を生成
npm --prefix frontend run preview   # http://localhost:5173 でプレビュー
```

## 開発コマンド

ルート `package.json` のスクリプト:

| コマンド | 説明 |
| --- | --- |
| `npm run build` | `frontend` の依存をインストールし `vite build` を実行（出力先 `frontend/dist`） |
| `npm run deploy` | `wrangler deploy` で Cloudflare Workers にデプロイ |
| `npm run lint` | `oxlint .` でリンティング |
| `npm run lint:fix` | `oxlint --fix .` で自動修正 |

`frontend/package.json` のスクリプト:

| コマンド | 説明 |
| --- | --- |
| `npm --prefix frontend run dev` | Vite 開発サーバーを起動 |
| `npm --prefix frontend run build` | `vite build` で本番ビルド |
| `npm --prefix frontend run preview` | `vite preview --port 5173` でビルド結果をプレビュー |

> 注: 自動テストおよび専用の型チェック用スクリプトは現状ありません。型は Vite のビルド時にトランスパイルされます。

## デプロイ

Cloudflare Workers 上で静的アセット（`frontend/dist`）を配信します。設定は `wrangler.toml` を参照してください。

```bash
# 事前に wrangler login などで認証しておくこと
npm run deploy
```

`wrangler.toml` の主な設定:

- `main = "worker/src/index.ts"`: リクエストを処理する Worker エントリポイント。
- `[build] command`: デプロイ前に `frontend` をビルド。
- `[assets] directory = "frontend/dist"`, `binding = "ASSETS"`: ビルド済みフロントエンドをアセットとして配信。

Worker（`worker/src/index.ts`）は以下を担当します:

- `/health` エンドポイント（`ok` を返し、`Cache-Control: no-store`）。
- 静的アセットの配信（`env.ASSETS.fetch`）。
- セキュリティヘッダの付与（CSP、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`、HSTS など）。
- キャッシュポリシー: HTML は `no-store`、CSS / JS / 画像は `public, max-age=31536000, immutable`。

## 構成

```
.
├── frontend/                 # フロントエンド（Vite + TypeScript, フレームワークレス）
│   ├── index.html            # エントリ HTML（UI マークアップ）
│   ├── style.css             # スタイル
│   ├── src/
│   │   ├── main.ts           # アプリ本体（変換・UI・ZIP 生成）
│   │   └── browserCapabilities.ts  # 画像形式の対応検出とフォールバック戦略
│   ├── package.json
│   └── tsconfig.json
├── worker/
│   └── src/index.ts          # Cloudflare Worker（アセット配信・セキュリティヘッダ）
├── wrangler.toml             # Cloudflare Workers 設定
├── package.json              # ルート（build / deploy / lint スクリプト）
├── .oxlintrc.json            # oxlint 設定
├── .github/workflows/lint.yml # CI（push / PR で oxlint 実行）
└── LICENSE                   # MIT
```

## ライセンス

[MIT License](./LICENSE) © 2025 MasakiOzeki
