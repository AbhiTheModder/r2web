import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { fileStore } from "./store/FileStore";
import "xterm/css/xterm.css";
import { Directory, type Instance, type Wasmer } from "@wasmer/sdk";

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
    active: boolean;
};
export const R2Tab = forwardRef<R2TabHandle, R2TabProps>(({ pkg, file, active }, ref) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const [termInstance, setTermInstance] = useState<Terminal | null>(null);
    const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
    const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
    const [r2Writer, setr2Writer] = useState<WritableStreamDefaultWriter<any> | undefined>(undefined);
    const [dir, setDir] = useState<Directory | null>(null);
    const onDataDisposableRef = useRef<any>(null);
    const [instance, setInstance] = useState<Instance | null>(null);

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
        dispose: () => {
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
        term.loadAddon(fit);
        term.loadAddon(search);
        term.loadAddon(clipboard);
        term.open(terminalRef.current);
        fit.fit();
        setTermInstance(term);
        setFitAddon(fit);
        setSearchAddon(search);
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
        let history: string[] = [];
        let historyIndex = -1;
        let currentInput = '';
        onDataDisposableRef.current?.dispose();

        onDataDisposableRef.current = term.onData((data) => {
            // Ctrl+C
            if (data === "\x03") {
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
                const searchTerm = prompt("Enter search term:");
                if (searchTerm) {
                    stdin?.write(encoder.encode(`/ ${searchTerm}`));
                    stdin?.write(encoder.encode("\r"));
                }
                return;
            }

            // CTRL+G
            if (data === "\x07" || data === "G") {
                const address = prompt("Enter address:");
                if (address) {
                    stdin?.write(encoder.encode(`s ${address}`));
                    stdin?.write(encoder.encode("\r"));
                }
                return;
            }

            // Enter key
            if (data === '\r') {
                if (currentInput.trim() !== '') {
                    history.push(currentInput);
                    historyIndex = history.length;
                    const prompt = term.buffer.active.getLine(term.buffer.active.cursorY)!.translateToString();
                    console.log('Prompt:', prompt);
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
        })();

        return () => {
            try {
                r2Writer?.close?.();
            } catch (_) { }
            try {
                instance?.free();
            } catch (_) { }
        };
    }, [pkg, termInstance, file]);

    useEffect(() => {
        if (active) {
            setTimeout(() => {
                try { fitAddon?.fit(); } catch { }
                termInstance?.focus();
            }, 0);
        }
    }, [active, fitAddon, termInstance]);

    return (
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
    );
});

export type { R2TabHandle };