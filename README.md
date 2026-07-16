<img border=0 src="public/r2cloud.svg" type="image/svg+xml" alt="logo" align="left" width="130px">


## r2web: __Access radare2 from anywhere, anytime.__

## Overview

r2web lets you run radare2 without local installs or platform hassles. Analyze files directly in your browser. It runs entirely client-side using radare2 WASI and Wasmer, with an [xterm.js](https://xtermjs.org/) frontend for interactive command execution.

👉 [Try it live](https://r2.revengi.in)

<details>
<summary>Click to view Screenshots</summary>

| | | |
| :---: | :---: | :---: |
| <img width="1000" height="928" alt="image" src="https://github.com/user-attachments/assets/2dc36f22-1f30-4c25-9c0e-daeb638d8259" /> | <img src="https://github.com/user-attachments/assets/1a680bd6-8852-419c-b69d-c97a3cdd9684" width="100%" /> | <img src="https://github.com/user-attachments/assets/a440c08c-de83-4318-b2d7-2d4944ffd5fc" width="100%" /> |
| **Dashboard** | **Shortcuts** | **Strings View** |
| <img src="https://github.com/user-attachments/assets/defad6ee-34a3-49c7-bda6-317f9660d899" width="100%" /> | <img src="https://github.com/user-attachments/assets/64b05356-4881-42af-b54f-19f24d54776a" width="100%" /> | <img src="https://github.com/user-attachments/assets/c5516ae6-fc36-45e9-a39a-bff1bcb42751" width="100%" /> |
| **Goto Address** | **Search** | **Graph View** |

</details>


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
*   [xterm.js](https://xtermjs.org/) for the terminal interface
*   Wasmer for running WASM
*   r2wasm for the WASM build of radare2

## Development

To run locally:
```shell
git clone https://github.com/radareorg/r2web.git
cd r2web
bun install
bun dev
```

you'll need to run a very small proxy api server to workaround with browser's CORS policy, to do that run:
```shell
bun run api/wasm.cjs # or node api/wasm.cjs if you don't have bun installed
```
which will run a local proxy server at `http://localhost:3000/wasm`, that will be used to fetch the wasm file from the github releases.

Or you can run both dev & proxy server at the same time using:
```shell
bun cc
```

To build for production:
```shell
bun run build
```

By default, the build assumes your app is served from the root path (`/`). If deploying to a subdirectory (e.g., `example.com/online`), set the `VITE_BASE_URL` environment variable:

```shell
VITE_BASE_URL=/online bun run build
```

> [!NOTE]
> Proxy server is only required to support multiple (older) versions of radare2. If you only care about the latest version, you can skip the proxy server.

Or skip the setup and [try it live](https://r2.revengi.in).

> [!TIP]
> 1. If you don't have bun installed, you can use npm or yarn or any other package manager which you have installed. Just replace `bun` with `npm` or `yarn` (or any other package manager) in the above commands.
>
> 2. When opening the built files directly from your file system (using `file://` protocol), you may encounter CORS errors. Static hosting with a proper HTTP server (like GitHub Pages, Netlify, Vercel, etc.) is recommended or start a local server.

## FAQ

**Q: Why am I unable to save files?**

Saving functionality is supported from **r2 version 6.0.3 onwards**. Earlier versions had a limitation on the r2-wasm side that has since been resolved.

**Q: Why isn't the Graph view loading?**

The Graph view requires **r2 version 6.0.9 or higher** to function correctly.

**Q: Which browsers are supported?**

While we aim for broad compatibility, there are currently known issues with **Firefox**. For the most stable experience, we recommend using **Chromium-based browsers** (such as Chrome, Edge, or Brave).

**Q: How is the radare2 binary handled?**

The binary is automatically downloaded on the first load and cached locally for future use. If you prefer not to store it, an option to disable caching is available at start during version selection.


## Contributing
Contributions are welcome! Please open an issue or submit a pull request. To keep the project aligned with its core goals, please keep the following guidelines in mind:
- **Avoid UI Boilerplates:** This project is built on the philosophy of self-integration. Please avoid adding external UI libraries (e.g., **Tailwind CSS**, **shadcn/ui**) or heavy boilerplates.
- **Minimize Dependencies:** We aim to keep the codebase lightweight. Whenever possible, try to implement logic and styling using native tools rather than adding new packages.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

- radare2 license can be found [here](https://github.com/radareorg/radare2/blob/master/COPYING.md).

## Similar Projects

- [r2wasm](https://github.com/radareorg/r2wasm) - Official r2wasm showcase project
- [radare2 online](https://radare2.online/) - Online version of radare2 [currently broken]
