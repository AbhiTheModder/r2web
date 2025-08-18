import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { fileStore } from "../store/FileStore";
import wasmerSDKModule from "@wasmer/sdk/wasm?url";
import "xterm/css/xterm.css";
import type { Instance, Wasmer } from "@wasmer/sdk";

export default function Radare2Terminal() {
    const terminalRef = useRef<HTMLDivElement>(null);
    const [termInstance, setTermInstance] = useState<Terminal | null>(null);
    const [_, setFitAddon] = useState<FitAddon | null>(null);
    const [wasmerInitialized, setWasmerInitialized] = useState(false);
    const [pkg, setPkg] = useState<Wasmer | null>(null);
    const wasmUrl = "https://radareorg.github.io/r2wasm/radare2.wasm?v=5.8.8";

    useEffect(() => {
        async function initializeWasmer() {
            const { Wasmer, init } = await import("@wasmer/sdk");
            await init({ module: wasmerSDKModule });
            setWasmerInitialized(true);

            const cache = await caches.open("wasm-cache");
            const cachedResponse = await cache.match(wasmUrl);
            if (cachedResponse) {
                const buffer = await cachedResponse.arrayBuffer();
                const packageInstance = Wasmer.fromWasm(new Uint8Array(buffer));
                setPkg(packageInstance);
                return;
            }
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const packageInstance = Wasmer.fromWasm(new Uint8Array(buffer));
            setPkg(packageInstance);
            cache.put(wasmUrl, response.clone());
            return;
        }

        initializeWasmer();

        return () => {
            if (termInstance) {
                termInstance.dispose();
            }
        };
    }, []);

    useEffect(() => {
        if (!wasmerInitialized || !pkg || !terminalRef.current) return;

        const term = new Terminal({ cursorBlink: true, convertEol: true });
        const fit = new FitAddon();

        term.loadAddon(fit);
        term.open(terminalRef.current);
        fit.fit();

        setTermInstance(term);
        setFitAddon(fit);

        term.writeln("Starting...");

        return () => {
            term.dispose();
        };
    }, [wasmerInitialized, pkg]);

    useEffect(() => {
        if (!termInstance || !pkg) return;

        async function runRadare2() {
            const file = fileStore.getFile();
            if (!file) {
                termInstance!.writeln("Error: No file provided");
                return;
            }

            termInstance!.write('\x1b[A');
            termInstance!.write('\x1b[2K');
            termInstance!.write('\r');

            const instance = await pkg!.entrypoint!.run({
                args: [file.name],
                mount: {
                    ["./"]: {
                        [file.name]: file.data,
                    },
                },
            });

            connectStreams(instance, termInstance!);
        }

        runRadare2();
    }, [termInstance, pkg]);

    function connectStreams(instance: Instance, term: Terminal) {
        const encoder = new TextEncoder();
        const stdin = instance.stdin?.getWriter();

        let cancelController: AbortController | null = null;
        let history: string[] = [];
        let historyIndex = -1;
        let currentInput = '';

        term.onData(data => {
            if (data === '\x03') { // Ctrl+C
                if (cancelController) {
                    cancelController.abort();
                    cancelController = null;
                    term.write("^C\r");
                    stdin?.write(encoder.encode("\r"));
                }
                return;
            }

            if (data === '\r') { // Enter key
                if (currentInput.trim() !== '') {
                    history.push(currentInput);
                    historyIndex = history.length;
                }
                currentInput = '';
            } else if (data === '\x1b[A') { // Up arrow
                if (historyIndex > 0) {
                    historyIndex--;
                    term.write('\x1b[2K\r' + history[historyIndex]);
                    currentInput = history[historyIndex];
                }
            } else if (data === '\x1b[B') { // Down arrow
                if (historyIndex < history.length - 1) {
                    historyIndex++;
                    term.write('\x1b[2K\r' + history[historyIndex]);
                    currentInput = history[historyIndex];
                } else if (historyIndex === history.length - 1) {
                    historyIndex++;
                    term.write('\x1b[2K\r');
                    currentInput = '';
                }
            } else if (data === '\x7f') { // Backspace
                if (currentInput.length > 0) {
                    currentInput = currentInput.slice(0, -1);
                    term.write('\x1b[D \x1b[D');
                }
            } else {
                currentInput += data;
            }

            try {
                if (cancelController) {
                    cancelController.abort();
                    cancelController = null;
                }

                cancelController = new AbortController();
                stdin?.write(encoder.encode(data));
            } catch (error) {
                console.error("Error writing to stdin:", error);
                term.write("\r\nError: Failed to write to stdin\r\n");
            }
        });


        const stdoutStream = new WritableStream({
            write: chunk => {
                try {
                    term.write(chunk);
                } catch (error) {
                    console.error("Error writing to stdout:", error);
                    term.write("\r\nError: Failed to write to stdout\r\n");
                }
            }
        });

        const stderrStream = new WritableStream({
            write: chunk => {
                try {
                    term.write(chunk);
                } catch (error) {
                    console.error("Error writing to stderr:", error);
                    term.write("\r\nError: Failed to write to stderr\r\n");
                }
            }
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

    return <div ref={terminalRef} style={{ height: "100vh", width: "100%" }} />;
}


