# AGENTS.md

このリポジトリで作業するコーディングエージェント向けのガイドです。憶測ではなく、実際のコードと設定に基づいて作業してください。

## プロジェクト概要

Image Sharpener は、ブラウザ内（Canvas API）で完結する画像変換ツールです。画像はサーバーに送信されず、すべての変換がクライアントサイドで行われます。ホスティングは Cloudflare Workers で、Worker は静的アセット配信とセキュリティヘッダ付与のみを担当します（画像処理はしません）。

## プロジェクト構成 / エントリポイント

- `frontend/`: Vite + TypeScript のフロントエンド（フレームワークレス、バニラ TS）。
  - `frontend/index.html`: UI マークアップ。要素 ID（`#fileInput`, `#dropzone`, `#quality`, `#format`, `#downloadAll`, `#retryFailed`, `#showCompatibility` など）は `main.ts` から `$()` ヘルパーで参照され、存在しないと実行時に例外を投げるため、HTML と TS の対応を崩さないこと。
  - `frontend/src/main.ts`: アプリ本体。ファイル投入、Canvas でのエンコード、品質/形式変更時の再エンコード、失敗のみ再試行、fflate による ZIP 生成を行う。
  - `frontend/src/browserCapabilities.ts`: AVIF/WebP の対応を Canvas エンコードで検出し、フォールバック形式（WebP/JPEG）を決定する `BrowserCapabilityDetector` とシングルトン `browserCapabilities` を提供。
  - `frontend/style.css`, `frontend/tsconfig.json`。
- `worker/src/index.ts`: Cloudflare Worker のエントリポイント（`wrangler.toml` の `main`）。`/health` の応答、`env.ASSETS.fetch` による静的配信、セキュリティヘッダとキャッシュポリシーの付与。
- `wrangler.toml`: Cloudflare Workers 設定（`main`, `[build]`, `[assets]`）。
- ルート `package.json`: `build` / `deploy` / `lint` / `lint:fix` スクリプト。
- `.github/workflows/lint.yml`: CI（push / pull_request で oxlint 実行、Node 20）。

## セットアップ

```bash
npm ci                    # ルート依存（oxlint, wrangler）
npm --prefix frontend ci  # フロントエンド依存（vite, typescript, fflate）
```

Node.js は CI と同じ **20** を使用してください。

## ビルド / lint / テスト / 型チェックのコマンド

実在するコマンドは以下のとおりです。

- **ビルド**:
  - `npm run build`（ルート）— `frontend` の依存を `npm ci` した上で `vite build` を実行。出力は `frontend/dist`。
  - `npm --prefix frontend run build` — フロントエンド単体のビルド。
  - `npm --prefix frontend run dev` — Vite 開発サーバー。
  - `npm --prefix frontend run preview` — ビルド結果をプレビュー（`--port 5173`）。
- **lint**:
  - `npm run lint` — `oxlint .`。**PR 前に必ず実行すること**（CI と同じチェック）。
  - `npm run lint:fix` — `oxlint --fix .`。
- **デプロイ**:
  - `npm run deploy` — `wrangler deploy`（Cloudflare 認証が必要）。
- **テスト**: 専用のテストスクリプト・テストコードは存在しません。追加する場合は既存構成に合わせて提案してください。
- **型チェック**: 専用の typecheck スクリプトはありません。型は Vite ビルド時にトランスパイルされます（`tsc --noEmit` は現状スクリプト化されておらず、実行すると未解決の型エラーが出ます）。型に関する変更を行う際は注意してください。

## コーディング規約

- **言語**: TypeScript。ソースコードのコメント・UI 文言・エラーメッセージは日本語で統一されています。既存のトーンに合わせてください。
- **リンタ**: oxlint（`.oxlintrc.json`）。`extends: ["oxlint:recommended"]`、`env` は browser/node/es2022、`eqeqeq: "warn"`。`.oxlintignore` で `frontend/dist/`, `node_modules/`, `**/*.min.js` を除外。
- **TypeScript 設定**（`frontend/tsconfig.json`）: `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`, `moduleResolution: "bundler"`, パスエイリアス `@/*` → `src/*`。未使用の変数・引数を残さないこと。
- **フレームワーク非依存**: React 等は使用していません。DOM 操作は素の API と `$()` ヘルパーで行います。
- **オブジェクト URL の解放**: `URL.createObjectURL` で作成した URL は削除・再エンコード・ページ離脱時に `revokeObjectURL` で解放する既存パターンを踏襲すること。
- **形式・フォールバック**: 新しい出力形式やフォールバック挙動を追加する場合は `browserCapabilities.ts` の検出ロジックと `main.ts` の MIME/拡張子マッピング（`getMimeType` / `getExtension`）を両方更新すること。

## 注意点

- 変更は最小限かつ目的に沿った範囲に留めること。無関係なファイルには触れない。
- Worker のセキュリティヘッダ（CSP など）やキャッシュポリシーを変更する際は影響範囲に注意すること。特に CSP は `script-src 'self'` 等で厳しめに設定されているため、外部リソースを追加すると壊れる可能性があります。
- 画像処理はブラウザ内で完結する設計です。サーバーサイド処理を安易に追加しないこと。
- pre-commit フックはありません。コミット前に `npm run lint` を手動で実行してください。
- デフォルトブランチは `main`。PR は `main` をベースに作成してください。
