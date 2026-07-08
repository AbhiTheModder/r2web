import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebLinksAddon } from '@xterm/addon-web-links';
import { fileStore } from "./store/FileStore";
import "xterm/css/xterm.css";
import { Directory, type Instance, type Wasmer } from "@wasmer/sdk";
import { InputView } from "./views/InputView";

type R2TabHandle = {
    focus: () => void;
    dispose: () => void;
    uploadFiles: (files: FileList) => Promise<void>;
    getWriter: () => WritableStreamDefaultWriter<any> | undefined;
    getSearchAddon: () => SearchAddon | null;
    getDir: () => Directory | null;
    restartSession: () => Promise<void>;
};

type R2TabProps = {
    pkg: Wasmer | null;
    file: { name: string; data: Uint8Array } | null;
    projectFile?: { name: string; data: Uint8Array } | null;
    active: boolean;
};
export const R2Tab = forwardRef<R2TabHandle, R2TabProps>(({ pkg, file, projectFile, active }, ref) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const [termInstance, setTermInstance] = useState<Terminal | null>(null);
    const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
    const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
    const [r2Writer, setr2Writer] = useState<WritableStreamDefaultWriter<any> | undefined>(undefined);
    const [dir, setDir] = useState<Directory | null>(null);
    const onDataDisposableRef = useRef<any>(null);
    const [instance, setInstance] = useState<Instance | null>(null);
    const [showSearch, setShowSearch] = useState(false);
    const [showSeekAddress, setShowSeekAddress] = useState(false);

    const restartSession = async () => {
        if (!pkg || !termInstance) return;
        const file = fileStore.getFile();
        if (!file) {
            termInstance!.writeln("Error: No file provided");
            return;
        }

        termInstance!.write("\x1b[A");
        termInstance!.write("\x1b[2K");
        termInstance!.write("\r");
        termInstance!.writeln("Restarting session...");

        // Close previous stdin writer if available to help terminate previous process streams
        try {
            await r2Writer?.close?.();
        } catch (_) { }

        // Free previous instance
        try {
            instance?.free();
        } catch (_) { }

        const mydir = new Directory();
        setDir(mydir);

        const newInstance = await pkg.entrypoint!.run({
            args: ["-e", "io.cache=1", "-e", "anal.depth=24", file.name],
            mount: {
                ["./"]: {
                    [file.name]: file.data,
                },
                mydir,
            },
        });

        setInstance(newInstance);
        connectStreams(newInstance, termInstance);
    };

    useImperativeHandle(ref, () => ({
        focus: () => {
            termInstance?.focus();
            fitAddon?.fit();
        },
        dispose: async () => {
            try { await r2Writer?.close(); } catch { }
            try { instance?.free(); } catch { }
            try { onDataDisposableRef.current?.dispose(); } catch { }
            try { termInstance?.dispose(); } catch { }
        },
        uploadFiles: async (files: FileList) => {
            if (!dir) return;
            const arr = Array.from(files);
            await Promise.all(arr.map(async (f) => {
                const buffer = new Uint8Array(await f.arrayBuffer());
                await dir.writeFile(`/${f.name}`, buffer);
            }));
        },
        getWriter: () => r2Writer,
        getSearchAddon: () => searchAddon,
        getDir: () => dir,
        restartSession,
    }), [termInstance, fitAddon, searchAddon, r2Writer, dir, restartSession]);

    useEffect(() => {
        if (!terminalRef.current) return;
        const term = new Terminal({
            cursorBlink: true,
            convertEol: true,
            scrollback: 90000,
            theme: { background: "#1e1e1e" },
        });
        const fit = new FitAddon();
        const search = new SearchAddon();
        const clipboard = new ClipboardAddon();
        const linkAddon = new WebLinksAddon(activateLink, linkHandler);
        term.loadAddon(fit);
        term.loadAddon(search);
        term.loadAddon(clipboard);
        term.loadAddon(linkAddon);
        term.open(terminalRef.current);
        fit.fit();
        setTermInstance(term);
        setFitAddon(fit);
        setSearchAddon(search);

        const fullWidthLine = (char: string) => char.repeat(term.cols);

        const centerPad = (text: string) => {
            const padding = Math.max(0, term.cols - text.length);
            const left = Math.floor(padding / 2);
            const right = padding - left;
            return " ".repeat(left) + text + " ".repeat(right);
        };

        const welcomeLines = [
            fullWidthLine("-"),
            centerPad("Welcome to r2web!"),
            centerPad("Source: https://github.com/radareorg/r2web"),
            fullWidthLine("-"),
            ""
        ];
        welcomeLines.forEach(line => term.writeln(line));
        term.writeln("Starting...");
        return () => {
            term.dispose();
        };
    }, []);

    function connectStreams(instance: Instance, term: Terminal) {
        const encoder = new TextEncoder();
        const stdin = instance.stdin?.getWriter();
        setr2Writer(stdin);

        let cancelController: AbortController | null = null;
        const history: string[] = [];
        let historyIndex = -1;
        let currentInput = '';
        onDataDisposableRef.current?.dispose();

        onDataDisposableRef.current = term.onData((data) => {
            // Ctrl+C
            if (data === "\x03") {
                if (term.hasSelection()) {
                    return;
                }

                if (cancelController) {
                    cancelController.abort();
                    cancelController = null;
                    term.write("^C\r");
                    stdin?.write(encoder.encode("\r"));
                }
                return;
            }

            // Ctrl+V
            if (data === "\x16") {
                navigator.clipboard.readText().then((text) => {
                    currentInput += text;
                    term.write(encoder.encode(text));
                }).catch((error) => {
                    console.error("Error reading clipboard:", error);
                    term.write("\r\nError: Failed to read clipboard\r\n");
                });
                return;
            }

            // Ctrl+R
            if (data === "\x12" || data === "R") {
                restartSession();
                return;
            }

            // Ctrl+L
            if (data === "\x0C" || data === "L") {
                term.clear();
                return;
            }

            // Ctrl+F
            if (data === "\x06" || data === "F") {
                setShowSearch(true);
                return;
            }

            // CTRL+G
            if (data === "\x07" || data === "G") {
                setShowSeekAddress(true);
                return;
            }

            // Enter key
            if (data === '\r') {
                if (currentInput.trim() !== '') {
                    history.push(currentInput);
                    historyIndex = history.length;
                    const prompt = term.buffer.active.getLine(term.buffer.active.cursorY)!.translateToString();
                    // console.log('Prompt:', prompt);
                    const cprompt = prompt.match(/\[0x.*\]/)?.[0];
                    if (cprompt) {
                        term.write('\x1b[2K\r' + cprompt + ' ');
                    } else {
                        term.write('\x1b[2K\r]> ');
                    }

                }
                stdin?.write(encoder.encode(currentInput));
                stdin?.write(encoder.encode('\r'));
                currentInput = '';
                return;
            }
            // Up arrow
            else if (data === '\x1b[A') {
                if (historyIndex > 0) {
                    historyIndex--;
                    term.write('\x1b[2K\r' + history[historyIndex]);
                    currentInput = history[historyIndex];
                }
                return;
            }
            // Down arrow
            else if (data === '\x1b[B') {
                if (historyIndex < history.length - 1) {
                    historyIndex++;
                    term.write('\x1b[2K\r' + history[historyIndex]);
                    currentInput = history[historyIndex];
                } else if (historyIndex === history.length - 1) {
                    historyIndex++;
                    term.write('\x1b[2K\r');
                    currentInput = '';
                }
                return;
            }
            // Backspace
            else if (data === '\x7f') {
                if (currentInput.length > 0) {
                    currentInput = currentInput.slice(0, -1);
                    term.write('\x1b[D \x1b[D');
                }
                return;
            }
            else {
                currentInput += data;
                term.write(data);
            }

            try {
                if (cancelController) {
                    cancelController.abort();
                    cancelController = null;
                }

                cancelController = new AbortController();
            } catch (error) {
                console.error("Error writing to stdin:", error);
                term.write("\r\nError: Failed to write to stdin\r\n");
            }
        });

        const stdoutStream = new WritableStream({
            write: (chunk) => {
                try {
                    term.write(chunk);
                } catch (error) {
                    console.error("Error writing to stdout:", error);
                    term.write("\r\nError: Failed to write to stdout\r\n");
                }
            },
        });

        const stderrStream = new WritableStream({
            write: (chunk) => {
                try {
                    term.write(chunk);
                } catch (error) {
                    console.error("Error writing to stderr:", error);
                    term.write("\r\nError: Failed to write to stderr\r\n");
                }
            },
        });

        instance.stdout.pipeTo(stdoutStream).catch((error: any) => {
            console.error("Error piping stdout:", error);
            term.write("\r\nError: Failed to pipe stdout\r\n");
        });

        instance.stderr.pipeTo(stderrStream).catch((error: any) => {
            console.error("Error piping stderr:", error);
            term.write("\r\nError: Failed to pipe stderr\r\n");
        });
    }

    useEffect(() => {
        if (!pkg || !termInstance) return;
        (async () => {
            if (!file) {
                termInstance.writeln("Error: No file provided");
                return;
            }
            termInstance.write("\x1b[A");
            termInstance.write("\x1b[2K");
            termInstance.write("\r");

            const mydir = new Directory();
            setDir(mydir);

            const newInstance = await pkg.entrypoint!.run({
                args: ["-e", "io.cache=1", "-e", "anal.depth=24", file.name],
                mount: {
                    ["./"]: { [file.name]: file.data },
                    mydir,
                },
            });
            setInstance(newInstance);
            connectStreams(newInstance, termInstance);

            if (projectFile) {
                await mydir.writeFile(`/${projectFile.name}`, projectFile.data);
                const writer = newInstance.stdin?.getWriter();
                if (writer) {
                    const enc = new TextEncoder();
                    writer.write(enc.encode("\r"));
                    writer.write(enc.encode(`Pzi mydir/${projectFile.name}`));
                    writer.write(enc.encode("\r"));
                    writer.releaseLock();
                }
                setTimeout(async () => {
                    try { await mydir.removeFile(`/${projectFile.name}`); } catch (_e) {}
                }, 3000);
            }
        })();

        return () => {
            try {
                if (r2Writer) {
                    r2Writer.close().catch(() => { });
                }
            } catch (_) { }
            try {
                instance?.free();
            } catch (_) { }
        };
    }, [pkg, termInstance, file, projectFile]);

    useEffect(() => {
        if (active) {
            setTimeout(() => {
                try { fitAddon?.fit(); } catch { }
                termInstance?.focus();
            }, 0);
        }
    }, [active, fitAddon, termInstance]);

    useEffect(() => {
        if (!termInstance) return;

        function handleKeyDown(event: KeyboardEvent) {
            const { key, ctrlKey, shiftKey, metaKey } = event;
            if ((key === "C" || key === "c") && shiftKey && (ctrlKey || metaKey)) {
                event.preventDefault();
                const selection = termInstance?.getSelection();
                if (selection) {
                    navigator.clipboard.writeText(selection).catch((err) => {
                        console.error("Failed to copy:", err);
                    });
                }
            }
        }

        // https://stackoverflow.com/a/62976613
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [termInstance]);

    return (
        <>
            <div style={{
                display: active ? "block" : "none",
                height: "100%",
                width: "100%",
                position: "absolute",
                inset: 0,
                overflow: "hidden"
            }}>
                <div ref={terminalRef} style={{
                    height: "100%",
                    width: "100%",
                    position: "absolute",
                    inset: 0
                }} />
            </div>
            <InputView
                isOpen={showSearch}
                title="Search"
                placeholder="Enter search term..."
                onClose={() => setShowSearch(false)}
                onSubmit={(value) => {
                    const writer = r2Writer;
                    if (writer) {
                        const encoder = new TextEncoder();
                        writer.write(encoder.encode(`/ ${value}`));
                        writer.write(encoder.encode("\r"));
                    }
                }}
            />
            <InputView
                isOpen={showSeekAddress}
                title="Go to Address"
                placeholder="Enter address (e.g., 0x1000)..."
                onClose={() => setShowSeekAddress(false)}
                onSubmit={(value) => {
                    const writer = r2Writer;
                    if (writer) {
                        const encoder = new TextEncoder();
                        writer.write(encoder.encode(`s ${value}`));
                        writer.write(encoder.encode("\r"));
                    }
                }}
            />
        </>
    );
});

export type { R2TabHandle };

let _linkPopup: HTMLDivElement | undefined;

function isMac() {
    return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}

function activateLink(event: MouseEvent, uri: string) {
    if (isMac() ? event.metaKey : event.ctrlKey) {
        window.open(uri, '_blank');
    }
}

function removeLinkPopup(_event: MouseEvent) {
    if (_linkPopup) {
        _linkPopup.remove();
        _linkPopup = undefined;
    }
}

function showLinkPopup(event: MouseEvent, _text: string) {
    removeLinkPopup(event);
    const popup = document.createElement('div');
    popup.classList.add('xterm-link-popup');
    popup.style.maxWidth = '260px';
    popup.style.wordBreak = 'break-word';
    popup.style.position = 'fixed';
    popup.style.top = (event.clientY + 25) + 'px';

    const container = (event.target as HTMLElement)?.parentElement || document.body;
    container.appendChild(popup);

    let left = event.clientX + 5;
    const overflow = left + popup.offsetWidth - container.clientWidth;
    if (overflow > 0) {
        left = Math.max(0, left - overflow - 5);
    }
    popup.style.left = left + 'px';

    // popup.innerText = text;
    // popup.appendChild(document.createElement('br'));

    const hint = document.createElement('i');
    hint.innerText = `(${isMac() ? 'Cmd' : 'Ctrl'}+Click to open link)`;
    popup.appendChild(hint);

    const popupHeight = popup.offsetHeight;
    if (event.clientY + 25 + popupHeight > container.clientHeight) {
        const y = event.clientY - 25 - popupHeight;
        popup.style.top = (y < 0 ? 0 : y) + 'px';
    }
    _linkPopup = popup;
}

const linkHandler = {
    activate: activateLink,
    hover: showLinkPopup,
    leave: removeLinkPopup,
    allowNonHttpProtocols: true
};
