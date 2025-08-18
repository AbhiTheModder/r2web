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
    const [wasmUrl, setWasmUrl] = useState("https://radareorg.github.io/r2wasm/radare2.wasm?v=6.0.0")
    const [sidebarOpen, setSidebarOpen] = useState(true);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const version = urlParams.get('version') || '6.0.0';
        setWasmUrl(`https://radareorg.github.io/r2wasm/radare2.wasm?v=${version}`);
        async function initializeWasmer() {
            const { Wasmer, init } = await import("@wasmer/sdk");
            await init({ module: wasmerSDKModule });
            setWasmerInitialized(true);

            const cache = await caches.open("wasm-cache");
            const cachedResponse = await cache.match(version);
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
            await cache.put(version, new Response(buffer));
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

        const term = new Terminal({
            cursorBlink: true, convertEol: true, theme: {
                background: "#1e1e1e"
            }
        });
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

    return (
        <div style={{ display: "grid", gridTemplateColumns: sidebarOpen ? "200px 1fr" : "0 1fr", height: "100vh", width: "100%", transition: "grid-template-columns 0.3s", backgroundColor: "#1e1e1e", borderRadius: "5px" }}>
            {sidebarOpen && (
                <div style={{ padding: "10px", overflow: "hidden", color: "#ffffff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3>Options</h3>
                        <button onClick={() => setSidebarOpen(false)}>×</button>
                    </div>
                    <ul style={{ listStyleType: "none", padding: 0 }}>
                        <li><button style={{ padding: "5px 5px 5px 5px", backgroundColor: "#2d2d2d", color: "#ffffff", width: "100%", textAlign: "center" }}>Disassembly</button></li>
                        <li><button style={{ padding: "5px 5px 5px 5px", backgroundColor: "#2d2d2d", color: "#ffffff", marginTop: "10px", width: "100%", textAlign: "center" }}>Decompiler</button></li>
                        <li><button style={{ padding: "5px 5px 5px 5px", backgroundColor: "#2d2d2d", color: "#ffffff", marginTop: "10px", width: "100%", textAlign: "center" }}>Hexdump</button></li>
                        <li><button style={{ padding: "5px 5px 5px 5px", backgroundColor: "#2d2d2d", color: "#ffffff", marginTop: "10px", width: "100%", textAlign: "center" }}>Strings</button></li>
                    </ul>
                </div>
            )}
            {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)} style={{ position: "fixed", left: "10px", top: "10px", zIndex: 1000 }}>☰</button>
            )}
            <div ref={terminalRef} style={{ height: "100%", width: "100%" }} />
        </div>
    );
}



