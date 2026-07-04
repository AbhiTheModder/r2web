# AGENTS.md — r2web

> Agent guidance for working effectively in the r2web repository.
> This is a React + TypeScript + Vite application that runs radare2 in the browser via WASI/WASM (Wasmer SDK) with an xterm.js terminal frontend.

---

## Project Overview

**r2web** is a browser-based interface for [radare2](https://rada.re). It lets users upload a binary and interact with a full r2 terminal entirely client-side. The heavy lifting is done by a radare2 WASM build loaded at runtime from GitHub releases.

Key architectural facts:

- Client-side only: no backend required for core functionality, except a small optional proxy for fetching non-default r2 WASM versions.
- The WASM binary is **not** bundled in the repo; it is downloaded on first use and optionally cached in the browser.
- Uses `SharedArrayBuffer`/WASI, so the dev server must send cross-origin isolation headers (`COOP`, `COEP`).

---

## Essential Commands

Use `aube` as the primary package manager (npm/yarn also work as drop-in replacements). All scripts are defined in `package.json`.

| Command | Purpose |
|---------|---------|
| `aube install` | Install dependencies. Also runs `postinstall`, which copies `coi-serviceworker.min.js` into `public/`. |
| `aube dev` | Start the Vite dev server. Serves the app with COOP/COEP headers and proxies `/wasm/*` to `http://localhost:3000`. |
| `aube cc` | Run **both** the Vite dev server and the local WASM proxy server (`api/wasm.cjs`) concurrently. This is the recommended local dev command. |
| `aube run build` | Type-check (`tsc -b`) and build for production. Output goes to `dist/`. |
| `aube run lint` | Run ESLint over the whole project. |
| `aube run preview` | Preview the production build locally. |
| `node api/wasm.cjs` | Start the local proxy server manually on port 3000. Useful if you don't have `aube`. |

### Environment variables for build/deploy

- `VITE_BASE_URL` — base path for production builds. Default is `/`. Example: `VITE_BASE_URL=/online aube run build`.
- `VITE_VERCEL_PROJECT_PRODUCTION_URL` / `VITE_VERCEL_URL` — used at runtime in production to route WASM downloads through the Vercel API (`api/vercel.js`).
- `VITE_WASM_SERVER` — optional override for the WASM proxy base URL in development.

---

## Code Organization

```
/
├── api/                 # Serverless/server helpers for WASM download
│   ├── vercel.js        # Vercel serverless function: downloads r2 release ZIP, streams radare2.wasm
│   └── wasm.cjs         # Local Express proxy for the same purpose
├── public/              # Static assets (favicon, logo, COI service worker)
├── src/
│   ├── main.tsx         # App entry: global styles, viewport lock, router
│   ├── r2tab.tsx        # Core terminal component: xterm + Wasmer instance per tab
│   ├── pages/
│   │   ├── Home.tsx     # Landing page: version picker, file upload, navigate to /r2
│   │   └── r2.tsx       # Main workspace: sidebar, tabs, views, WASM loading
│   ├── store/
│   │   └── FileStore.tsx# Simple singleton holding the uploaded file between pages
│   ├── utils/
│   │   ├── cfgParser.ts # Parses r2 `agfj` JSON into a typed CFG
│   │   └── elkLayout.ts # Runs ELK.js layout on the parsed CFG
│   └── views/
│       ├── CFGView.tsx      # Interactive SVG control-flow graph
│       ├── CodeEditorView.tsx# File editor for /mydir with r2.js completions
│       ├── ConfirmDialog.tsx
│       ├── HexView.tsx      # Paginated hexdump viewer
│       ├── InputView.tsx    # Generic modal input (search, seek)
│       └── StringsView.tsx  # Paginated strings table
```

---

## Architecture & Control Flow

### 1. Boot flow

1. `Home.tsx` lets the user pick a radare2 version and upload a file.
2. The file is stored in `FileStore` (a singleton) and the app navigates to `/r2?version=X&cache=Y`.
3. `r2.tsx` initializes the Wasmer SDK, fetches the requested `radare2.wasm` from GitHub releases (or cache), and calls `Wasmer.fromWasm(buffer)` to create a `pkg`.
4. `R2Tab` creates an `Instance` by running `pkg.entrypoint!.run(...)` with the uploaded file mounted under `./` and a `Directory` mounted as `mydir`.

### 2. Terminal I/O

- `R2Tab` owns an `xterm.js` Terminal.
- User keystrokes are captured via `term.onData`, translated, and written to the instance's `stdin` writer.
- `instance.stdout`/`stderr` are piped to the terminal via `WritableStream`s.
- A local command history and simple line editing are implemented manually inside `onData`.

### 3. Auxiliary views

The sidebar buttons in `r2.tsx` send r2 commands to the active tab's stdin and read results from the mounted `mydir` directory:

- **Strings**: `izj > mydir/.strings`
- **Hexdump**: `px > mydir/.hexdump`
- **Graph**: `aa; agfj > mydir/.graph`

After a short timeout, the file is read from `Directory`, parsed, and passed to the corresponding view. This is the project's standard pattern for extracting structured data from r2.

### 4. File uploads inside a session

Files dropped/selected in `r2.tsx` are written into the active tab's `Directory` via `R2Tab.uploadFiles`. Files ending in `.r2` or `.r2.js` trigger a confirmation dialog; if confirmed, they are uploaded and executed with `. /mydir/<filename>`.

---

## Key Conventions & Patterns

### Styling

- **No CSS framework.** Styles are written inline or in `<style>` blocks inside components.
- Global button/input theming is done via a `<style>` block in `r2.tsx` that targets `.app-root button`, `.app-root input`, etc.
- Components commonly use `position: fixed; inset: 0` for modal overlays with a z-index around `1000`.

### TypeScript

- Strict mode enabled. `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax` are on.
- `any` is allowed (`@typescript-eslint/no-explicit-any: off`).
- Unused vars must start with `_`.
- Imports of types use `import type { ... }` to satisfy `verbatimModuleSyntax`.

### React

- Functional components with hooks. No class components.
- `react-router-dom` v7 is used for the two routes (`/` and `/r2`).
- `BrowserRouter` basename is set to `import.meta.env.BASE_URL` so the app works under a subdirectory.
- Refs to child components use `forwardRef` + `useImperativeHandle` (see `R2Tab`).

### Naming

- Components: PascalCase files (`CFGView.tsx`, `Home.tsx`).
- Utility files: camelCase (`cfgParser.ts`, `elkLayout.ts`).
- The radare2 page is intentionally lowercase `r2.tsx` to match the route name.

---

## Important Gotchas

### Cross-Origin Isolation is required

The dev server sends these headers in `vite.config.ts`:

```ts
"Cross-Origin-Opener-Policy": "same-origin"
"Cross-Origin-Embedder-Policy": "require-corp"
```

Production hosting must also send them, otherwise `SharedArrayBuffer` (used by Wasmer) fails. The `coi-serviceworker` script in `index.html` helps on hosts that don't set the headers natively.

### Sending commands to the terminal

When programmatically driving the radare2 terminal from `r2.tsx` (or anywhere else with a writer from `getActiveWriter()`), commands must be framed with `\r` before and after the command string. The leading `\r` ensures any existing partial input is submitted/cleared, and the trailing `\r` executes the command:

```ts
const writer = getActiveWriter();
const encoder = new TextEncoder();
if (writer) {
    writer.write(encoder.encode("\r"));
    writer.write(encoder.encode("agfj > mydir/.graph"));
    writer.write(encoder.encode("\r"));
}
```

This pattern is used throughout the auxiliary views (Strings, Hexdump, Graph) to run r2 commands or redirect output into `mydir` for later reading.

### The proxy server is required for non-default versions

- Default version `6.1.8` is loaded from `https://radareorg.github.io/r2wasm/radare2.wasm` directly.
- Other versions are fetched from GitHub releases as a ZIP. Browsers cannot fetch GitHub release ZIPs directly due to CORS, so a proxy is required.
- `aube cc` runs both Vite and the proxy. The proxy is at `api/wasm.cjs` on port `3000`; Vite proxies `/wasm/:version` to it.
- In Vercel production, `api/vercel.js` serves the same role.

### `@wasmer/sdk` is excluded from dependency optimization

In `vite.config.ts`:

```ts
optimizeDeps: { exclude: ['@wasmer/sdk'] }
```

Do not remove this. Wasmer's package must be loaded via its own WASM module at runtime, not bundled/optimized by Vite.

### Wasmer SDK module import

The Wasmer SDK runtime is imported as:

```ts
import wasmerSDKModule from "@wasmer/sdk/wasm?url";
```

and then initialized with:

```ts
const { Wasmer, init } = await import("@wasmer/sdk");
await init({ module: wasmerSDKModule });
```

### r2 instance lifecycle

- Each `R2Tab` owns one `Instance`.
- When the tab is disposed or restarted, close the stdin writer **first**, then call `instance.free()`. Order matters to avoid stream errors.
- The `Directory` object is created per instance and is the only way to exchange files with r2 (used by all auxiliary views).

### Graph view requires r2 ≥ 6.0.9

The `agfj` command used by `CFGView` does not work correctly in older WASM builds of r2. The app does not enforce this; it just fails to load the graph.

### Saving files requires r2 ≥ 6.0.3

Writing back to the mounted binary depends on a fix in the r2 WASM build. Earlier versions cannot save modifications.

### Browser support

- Chromium-based browsers are recommended.
- Firefox has known issues with the WASM/WASI stack.

---

## Testing

There is currently no test framework configured in this repository. The project relies on manual testing via `aube dev` / `aube cc` and the production build preview.

When adding features, verify:

1. `aube run lint` passes.
2. `aube run build` passes type-check and produces a `dist/` build.
3. The feature works in the dev server with the proxy running (`aube cc`).
4. The feature works in `aube run preview` (which more closely matches production headers and bundling).

---

## Linting Rules Worth Knowing

- `eslint.config.js` uses `typescript-eslint`, `react-hooks`, and `react-refresh` configs.
- `react-hooks/exhaustive-deps` is **off**. Do not rely on it; review dependency arrays manually.
- `no-empty` is on, but empty catch blocks are allowed (`allowEmptyCatch: true`).
- Unused variables/parameters must be prefixed with `_`.

---

## Dependency Philosophy

From the project README and existing code:

- **Avoid adding UI libraries** such as Tailwind, shadcn/ui, or heavy component kits.
- **Minimize dependencies.** Prefer native browser APIs and inline styles.
- Only add a new package if the same functionality cannot be achieved reasonably with what's already installed.

---

## Useful File References

- `src/r2tab.tsx` — terminal lifecycle and r2 stdin/stdout plumbing.
- `src/pages/r2.tsx` — sidebar, tabs, view orchestration, and WASM download logic.
- `src/utils/cfgParser.ts` + `src/utils/elkLayout.ts` — graph parsing and layout.
- `api/wasm.cjs` + `api/vercel.js` — WASM proxy for GitHub release ZIPs.
- `vite.config.ts` — build output names, manual chunks, COOP/COEP headers, proxy.

---

## When in Doubt

- Run `aube cc` for local development; it covers both the app and the proxy.
- Check `README.md` for user-facing setup and FAQ.
- Keep the UI dependency-light and style inline unless there is a strong reason to diverge.
