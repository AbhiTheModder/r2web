<img border=0 src="public/r2cloud.svg" type="image/svg+xml" alt="screenshot" align="left" width="130px">


## r2web: __Access radare2 from anywhere, anytime.__


## Overview

r2web lets you run radare2 without local installs or platform hassles. Analyze files directly in your browser. It runs entirely client-side using WASIX and Wasmer, with an xterm.js frontend for interactive command execution.

## Features

- **Browser-based**: No local installation required
- **Cross-platform**: Works on any device with a modern browser (since older browsers don't support WASI/WASM)
- **Terminal Interface:** Interact with r2 via a familiar terminal.
- **Keyboard Shortcuts:** Navigate quickly using some known GUI shortcuts (like `Ctrl+G` for seek).
- **Search:** Ability to search in large outputs of commands.
- **Custom r2 versions:** Use any version of r2 you want.
- **Quick Buttons:** Buttons for common commands like `pd`, `px`, `iz`.

## Under the Hood

r2web uses:

*   React+TypeScript+Vite
*   xterm.js for the terminal interface
*   Wasmer for running WASM
*   r2wasm for the WASM build of radare2

## Development

To run locally:
```shell
git clone https://github.com/AbhiTheModder/r2web.git
cd r2web
bun install
bun dev
```

> [!TIP]
> If you don't have bun installed, you can use npm or yarn or any other package manager which you have installed. Just replace `bun` with `npm` or `yarn` (or any other package manager) in the above commands.

## Notes

- This is a work in progress. Expect bugs and missing features.
- The radare2 binary is downloaded on first load and cached for future use.
- No history support.
- Currently there's no way to save modified files, (seems like an issue on r2wasm side), figuring out a way to fix it.

## Similar Projects

- [r2wasm](https://github.com/radareorg/r2wasm) - Official r2wasm showcase project
- [radare2 online](https://radare2.online/) - Online version of radare2 [currently broken]
