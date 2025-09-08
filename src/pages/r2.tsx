import { useEffect, useRef, useState, forwardRef, useImperativeHandle, createRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { fileStore } from "../store/FileStore";
import wasmerSDKModule from "@wasmer/sdk/wasm?url";
import "xterm/css/xterm.css";
import { Directory, type Instance, type Wasmer } from "@wasmer/sdk";

type R2TabHandle = {
    focus: () => void;
    dispose: () => void;
    uploadFiles: (files: FileList) => Promise<void>;
    getWriter: () => WritableStreamDefaultWriter<any> | undefined;
    getSearchAddon: () => SearchAddon | null;
    getDir: () => Directory | null;
};

type R2TabProps = {
    pkg: Wasmer | null;
    file: { name: string; data: Uint8Array } | null;
    active: boolean;
};

function connectStreams(
    instance: Instance,
    term: Terminal,
    onWriter?: (w: WritableStreamDefaultWriter<any> | undefined) => void,
) {
    const encoder = new TextEncoder();
    const stdin = instance.stdin?.getWriter();
    if (onWriter) onWriter(stdin);

    let cancelController: AbortController | null = null;

    term.onData((data) => {
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

        // CTRL+G
        if (data === "\x07" || data === "G") {
            const address = prompt("Enter address:");
            if (address) {
                stdin?.write(encoder.encode(`s ${address}`));
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

const R2Tab = forwardRef<R2TabHandle, R2TabProps>(({ pkg, file, active }, ref) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const onDataDisposableRef = useRef<any>(null);
    const [termInstance, setTermInstance] = useState<Terminal | null>(null);
    const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
    const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
    const [r2Writer, setr2Writer] = useState<WritableStreamDefaultWriter<any> | undefined>(undefined);
    const [dir, setDir] = useState<Directory | null>(null);

    useImperativeHandle(ref, () => ({
        focus: () => {
            termInstance?.focus();
            fitAddon?.fit();
        },
        dispose: () => {
            try { termInstance?.dispose(); } catch {}
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
    }), [termInstance, fitAddon, searchAddon, r2Writer, dir]);

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
        term.loadAddon(fit);
        term.loadAddon(search);
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

            const instance = await pkg.entrypoint!.run({
                args: [file.name],
                mount: {
                    ["./"]: { [file.name]: file.data },
                    mydir,
                },
            });
            connectStreams(instance, termInstance, setr2Writer);
        })();
    }, [pkg, termInstance]);

    useEffect(() => {
        if (active) {
            setTimeout(() => {
                try { fitAddon?.fit(); } catch {}
                termInstance?.focus();
            }, 0);
        }
    }, [active, fitAddon, termInstance]);

    return (
        <div style={{ display: active ? "block" : "none", height: "100%", width: "100%" }}>
            <div ref={terminalRef} style={{ minHeight: "100vh", width: "100%" }} />
        </div>
    );
});

export default function Radare2Terminal() {
    const [wasmerInitialized, setWasmerInitialized] = useState(false);
    const [pkg, setPkg] = useState<Wasmer | null>(null);
    const [wasmUrl, setWasmUrl] = useState(
        "https://radareorg.github.io/r2wasm/radare2.wasm?v=6.0.0"
    );
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
    const [searchRegex, setSearchRegex] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadPhase, setDownloadPhase] = useState<
        "initializing" | "downloading" | "processing" | "complete"
    >("initializing");
    const [cachedVersions, setCachedVersions] = useState<string[]>([]);
    const [showCachedVersions, setShowCachedVersions] = useState(false);
    const [dir, setDir] = useState<Directory | null>(null);
    const [instance, setInstance] = useState<Instance | null>(null);
    // Tabs state
    const [tabs, setTabs] = useState<number[]>([0]);
    const [activeTab, setActiveTab] = useState(0);
    const tabRefs = useRef<Record<number, React.RefObject<R2TabHandle>>>({});
    if (!tabRefs.current[0]) tabRefs.current[0] = createRef<R2TabHandle>();

    const file = fileStore.getFile();
    const isFileSelected = file !== null;

    function getActiveWriter() {
        const ref = tabRefs.current[activeTab]?.current;
        return ref?.getWriter();
    }
    function getActiveSearchAddon() {
        const ref = tabRefs.current[activeTab]?.current;
        return ref?.getSearchAddon() || null;
    }
    function getActiveDir() {
        const ref = tabRefs.current[activeTab]?.current;
        return ref?.getDir() || null;
    }

    useEffect(() => {
        const ref = tabRefs.current[activeTab]?.current;
        ref?.focus();
    }, [activeTab]);

    async function fetchCachedVersions() {
        const cache = await caches.open("wasm-cache");
        const keys = await cache.keys();
        setCachedVersions(keys.map((request) => new URL(request.url).pathname.replace("/", "")));
    }
    useEffect(() => { fetchCachedVersions(); }, []);
    
    const handleUploadInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) return;
        const dir = getActiveDir();
        if (!dir) {
            // Try via tab's method as fallback
            const ref = tabRefs.current[activeTab]?.current;
            if (ref) await ref.uploadFiles(event.target.files);
            return;
        }
        const files = Array.from(event.target.files);
        await Promise.all(files.map(async (f) => {
            const buffer = new Uint8Array(await f.arrayBuffer());
            await dir.writeFile(`/${f.name}`, buffer);
        }));
    };

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const version = urlParams.get("version") || "6.0.0";
        const doCache = urlParams.get("cache") === "true";
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
            setDownloadPhase("initializing");
            setIsDownloading(true);
            setDownloadProgress(10);

            setDownloadPhase("downloading");
            setDownloadProgress(30);

            let response: Response;
            try {
                response = await fetch(wasmUrl);
            } catch (e) {
                console.error(e);
                setIsDownloading(false);
                return;
            }

            const contentLength = response.headers.get("content-length");
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            let loaded = 0;

            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunks.push(value);
                    loaded += value.length;

                    if (total > 0) {
                        const progress = Math.min(30 + (loaded / total) * 50, 80);
                        setDownloadProgress(progress);
                    }
                }
            }

            setDownloadPhase("processing");
            setDownloadProgress(85);

            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const buffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                buffer.set(chunk, offset);
                offset += chunk.length;
            }

            setDownloadProgress(90);

            const packageInstance = Wasmer.fromWasm(buffer);
            setPkg(packageInstance);

            setDownloadProgress(95);

            if (doCache) {
                await cache.put(version, new Response(buffer));
            }

            setDownloadProgress(100);
            setDownloadPhase("complete");

            setTimeout(() => setIsDownloading(false), 500);
        }

        initializeWasmer();

        return () => {
            // Dispose all terminals on unmount
            Object.values(tabRefs.current).forEach((r) => r.current?.dispose());
        };
    }, []);


    useEffect(() => {
        if (!wasmerInitialized || !pkg || !terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            convertEol: true,
            scrollback: 90000,
            theme: {
                background: "#1e1e1e",
            },
        });
        const fit = new FitAddon();
        const search = new SearchAddon();

        term.loadAddon(fit);
        term.loadAddon(search);
        term.open(terminalRef.current);
        fit.fit();

        setTermInstance(term);
        setFitAddon(fit);
        setSearchAddon(search);

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

            onDataDisposableRef.current?.dispose();

            termInstance!.write("\x1b[A");
            termInstance!.write("\x1b[2K");
            termInstance!.write("\r");

            const mydir = new Directory();
            setDir(mydir);

            const instance = await pkg!.entrypoint!.run({
                args: [file.name],
                mount: {
                    ["./"]: {
                        [file.name]: file.data,
                    },
                    mydir,
                },
            });

            setInstance(instance);

            connectStreams(instance, termInstance!);
        }

        runRadare2();
    }, [termInstance, pkg]);

    function connectStreams(instance: Instance, term: Terminal) {
        const encoder = new TextEncoder();
        const stdin = instance.stdin?.getWriter();
        setr2Writer(stdin);

        let cancelController: AbortController | null = null;

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

            // CTRL+G
            if (data === "\x07" || data === "G") {
                const address = prompt("Enter address:");
                if (address) {
                    stdin?.write(encoder.encode(`s ${address}`));
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
            write: (chunk) => {
                try {
                    // console.log("stdout:", new TextDecoder().decode(chunk));
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

    // Restart the current session by spawning a new Wasm instance running the same binary
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
            args: [file.name],
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

    const handleSearch = () => {
        const searchAddon = getActiveSearchAddon();
        if (!searchAddon || !searchTerm) return;
        searchAddon.findNext(searchTerm, {
            caseSensitive: searchCaseSensitive,
            regex: searchRegex,
        });
    };

    const handleSearchPrevious = () => {
        const searchAddon = getActiveSearchAddon();
        if (!searchAddon || !searchTerm) return;
        searchAddon.findPrevious(searchTerm, {
            caseSensitive: searchCaseSensitive,
            regex: searchRegex,
        });
    };

    // Keyboard shortcuts for tab switching
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Ignore when typing in inputs
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (e.altKey) {
                if (e.code.startsWith('Digit')) {
                    const num = parseInt(e.code.replace('Digit', ''), 10);
                    if (num >= 1 && num <= 9) {
                        e.preventDefault();
                        const idx = Math.min(num - 1, tabs.length - 1);
                        setActiveTab(tabs[idx]);
                    }
                } else if (e.code === 'ArrowRight') {
                    e.preventDefault();
                    const order = tabs;
                    const curIndex = order.indexOf(activeTab);
                    const next = order[(curIndex + 1) % order.length];
                    setActiveTab(next);
                } else if (e.code === 'ArrowLeft') {
                    e.preventDefault();
                    const order = tabs;
                    const curIndex = order.indexOf(activeTab);
                    const next = order[(curIndex - 1 + order.length) % order.length];
                    setActiveTab(next);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [tabs, activeTab]);

    return (
        <>
            {/* Global reset to fill viewport and prevent Safari bounce */}
            <style>{`
                html, body, #root { height: 100%; }
                html, body { margin: 0; padding: 0; background: #1e1e1e; overscroll-behavior: none; }
                /* Prevent page scroll/rubber-band; we scroll inside .app-root instead */
                body { position: fixed; inset: 0; overflow: hidden; }
                .app-root { height: 100vh; width: 100vw; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
            `}</style>
            {isDownloading && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        minHeight: "100vh",
                        backgroundColor: "#1e1e1e",
                        color: "#ffffff",
                        fontFamily: "system-ui, -apple-system, sans-serif",
                    }}
                >
                    <img
                        src="/r2.png"
                        alt="Radare2 Logo"
                        style={{
                            width: "80px",
                            height: "80px",
                            marginBottom: "30px",
                            animation: "pulse 2s infinite",
                        }}
                    />

                    <h2
                        style={{
                            marginBottom: "30px",
                            fontSize: "24px",
                            fontWeight: "300",
                        }}
                    >
                        {downloadPhase === "initializing" && "Initializing Radare2..."}
                        {downloadPhase === "downloading" && "Downloading Radare2..."}
                        {downloadPhase === "processing" && "Processing..."}
                        {downloadPhase === "complete" && "Ready!"}
                    </h2>

                    <div
                        style={{
                            width: "400px",
                            maxWidth: "80vw",
                            backgroundColor: "#2d2d2d",
                            borderRadius: "12px",
                            padding: "8px",
                            marginBottom: "20px",
                            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                        }}
                    >
                        <div
                            style={{
                                width: `${downloadProgress}%`,
                                height: "8px",
                                backgroundColor:
                                    downloadPhase === "complete" ? "#27ae60" : "#3498db",
                                borderRadius: "6px",
                                transition: "all 0.3s ease",
                                background:
                                    downloadPhase === "complete"
                                        ? "linear-gradient(90deg, #27ae60, #2ecc71)"
                                        : "linear-gradient(90deg, #3498db, #5dade2)",
                                position: "relative",
                                overflow: "hidden",
                            }}
                        >
                            <div
                                style={{
                                    position: "absolute",
                                    top: 0,
                                    left: "-100%",
                                    width: "100%",
                                    height: "100%",
                                    background:
                                        "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
                                    animation:
                                        downloadPhase !== "complete"
                                            ? "shimmer 2s infinite"
                                            : "none",
                                }}
                            />
                        </div>
                    </div>

                    <p
                        style={{
                            fontSize: "16px",
                            color: "#bbb",
                            marginBottom: "10px",
                        }}
                    >
                        {Math.round(downloadProgress)}%
                    </p>

                    <p
                        style={{
                            fontSize: "14px",
                            color: "#888",
                            textAlign: "center",
                            maxWidth: "400px",
                        }}
                    >
                        {downloadPhase === "initializing" && "Setting up runtime..."}
                        {downloadPhase === "downloading" &&
                            "Downloading radare2 (will not download again in future)..."}
                        {downloadPhase === "processing" &&
                            "Initializing radare2 instance..."}
                        {downloadPhase === "complete" && "Radare2 is ready to use!"}
                    </p>

                    <style>{`
                    @keyframes pulse {
                        0% { transform: scale(1); opacity: 1; }
                        50% { transform: scale(1.05); opacity: 0.8; }
                        100% { transform: scale(1); opacity: 1; }
                    }
                    
                    @keyframes shimmer {
                        0% { left: -100%; }
                        100% { left: 100%; }
                    }
                `}</style>
                </div>
            )}
            {/* Tabs bar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                height: '36px', padding: '4px 6px',
                backgroundColor: '#111', color: '#fff',
                overflowX: 'auto', position: 'sticky', top: 0, zIndex: 5,
                borderBottom: '1px solid #333'
            }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {tabs.map((id, i) => (
                        <button key={id} onClick={() => setActiveTab(id)}
                            style={{
                                whiteSpace: 'nowrap',
                                maxWidth: '160px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                backgroundColor: id === activeTab ? '#2d2d2d' : '#1c1c1c',
                                color: '#fff', border: '1px solid #333',
                                display: 'flex', alignItems: 'center', gap: '8px'
                            }}>
                            <span>{`Tab ${i + 1}`}{file ? `: ${file.name}` : ''}</span>
                            <span onClick={(e) => {
                                e.stopPropagation();
                                const ref = tabRefs.current[id]?.current;
                                ref?.dispose();
                                setTabs((prev) => {
                                    const idx = prev.indexOf(id);
                                    const remaining = prev.filter((tid) => tid !== id);
                                    if (activeTab === id) {
                                        const nextActive = remaining.length ? remaining[Math.max(0, idx - 1)] : -1;
                                        setActiveTab(nextActive);
                                    }
                                    return remaining;
                                });
                            }} style={{ cursor: 'pointer', opacity: 0.8 }}>×</span>
                        </button>
                    ))}
                </div>
                <button onClick={() => {
                    setTabs((prev) => {
                        const nextId = prev.length ? Math.max(...prev) + 1 : 0;
                        const newArr = [...prev, nextId];
                        if (!tabRefs.current[nextId]) tabRefs.current[nextId] = createRef<R2TabHandle>();
                        setActiveTab(nextId);
                        return newArr;
                    });
                }}
                    style={{ marginLeft: 'auto', padding: '6px 10px', borderRadius: '6px', backgroundColor: '#1c1c1c', color: '#fff', border: '1px solid #333' }}>+
                </button>
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: sidebarOpen ? "200px 1fr" : "0 1fr",
                    minHeight: "100vh",
                    width: "100%",
                    transition: "grid-template-columns 0.3s",
                    backgroundColor: "#1e1e1e",
                    borderRadius: "5px",
                }}
            >
            <div className="app-root">
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: sidebarOpen ? "200px 1fr" : "0 1fr",
                        height: "100vh",
                        width: "100vw",
                        transition: "grid-template-columns 0.3s",
                        backgroundColor: "#1e1e1e",
                    }}
                >
                {sidebarOpen && (
                    <div
                        style={{ padding: "10px", overflow: "hidden", color: "#ffffff" }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <h3>Options</h3>
                            <button
                                style={{ backgroundColor: "#2d2d2d", color: "#ffffff" }}
                                onClick={() => setSidebarOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <ul style={{ listStyleType: "none", padding: 0 }}>
                            <li style={{ marginBottom: "8px" }}>
                                <button
                                    onClick={restartSession}
                                    disabled={!isFileSelected || !pkg}
                                    style={{
                                        padding: "6px 5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        width: "100%",
                                        textAlign: "center",
                                    }}
                                >
                                    Restart Session
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={() => {
                                        if (!isFileSelected) return;
                                        const encoder = new TextEncoder();
                                        const w = getActiveWriter();
                                        w?.write(encoder.encode('?e "\\ec"'));
                                        w?.write(encoder.encode("\r"));
                                        w?.write(encoder.encode("pd"));
                                        w?.write(encoder.encode("\r"));
                                    }}
                                    disabled={!isFileSelected}
                                    style={{
                                        padding: "5px 5px 5px 5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        width: "100%",
                                        textAlign: "center",
                                    }}
                                >
                                    Disassembly
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={() => {
                                        if (!isFileSelected) return;
                                        const encoder = new TextEncoder();
                                        const w = getActiveWriter();
                                        w?.write(encoder.encode('?e "\\ec"'));
                                        w?.write(encoder.encode("\r"));
                                        w?.write(encoder.encode("pdc"));
                                        w?.write(encoder.encode("\r"));
                                    }}
                                    disabled={!isFileSelected}
                                    style={{
                                        padding: "5px 5px 5px 5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        marginTop: "10px",
                                        width: "100%",
                                        textAlign: "center",
                                    }}
                                >
                                    Decompiler
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={() => {
                                        if (!isFileSelected) return;
                                        const encoder = new TextEncoder();
                                        const w = getActiveWriter();
                                        w?.write(encoder.encode('?e "\\ec"'));
                                        w?.write(encoder.encode("\r"));
                                        w?.write(encoder.encode("px"));
                                        w?.write(encoder.encode("\r"));
                                    }}
                                    disabled={!isFileSelected}
                                    style={{
                                        padding: "5px 5px 5px 5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        marginTop: "10px",
                                        width: "100%",
                                        textAlign: "center",
                                    }}
                                >
                                    Hexdump
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={() => {
                                        if (!isFileSelected) return;
                                        const encoder = new TextEncoder();
                                        const w = getActiveWriter();
                                        w?.write(encoder.encode('?e "\\ec"'));
                                        w?.write(encoder.encode("\r"));
                                        w?.write(encoder.encode("iz"));
                                        w?.write(encoder.encode("\r"));
                                    }}
                                    disabled={!isFileSelected}
                                    style={{
                                        padding: "5px 5px 5px 5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        marginTop: "10px",
                                        width: "100%",
                                        textAlign: "center",
                                    }}
                                >
                                    Strings
                                </button>
                            </li>
                            <li style={{ marginTop: "10px" }}>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search..."
                                    style={{
                                        padding: "5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        width: "95%",
                                        border: "none",
                                    }}
                                />
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        marginTop: "5px",
                                    }}
                                >
                                    <label style={{ display: "flex", alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={searchCaseSensitive}
                                            onChange={() =>
                                                setSearchCaseSensitive(!searchCaseSensitive)
                                            }
                                            style={{ marginRight: "5px" }}
                                        />
                                        Case Sensitive
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={searchRegex}
                                            onChange={() => setSearchRegex(!searchRegex)}
                                            style={{ marginRight: "5px" }}
                                        />
                                        Regex
                                    </label>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        marginTop: "5px",
                                    }}
                                >
                                    <button
                                    onClick={handleSearch}
                                    style={{
                                        padding: "5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        width: "48%",
                                    }}
                                >
                                    Next
                                </button>
                                <button
                                    onClick={handleSearchPrevious}
                                    style={{
                                        padding: "5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        width: "48%",
                                    }}
                                >
                                    Previous
                                </button>
                                </div>
                            </li>
                            {cachedVersions.length > 0 && (
                                <li style={{ marginTop: "10px" }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                        }}
                                    >
                                        <span>Cached Versions:</span>
                                        <button
                                            onClick={() => setShowCachedVersions(!showCachedVersions)}
                                            style={{
                                                padding: "5px",
                                                backgroundColor: "#2d2d2d",
                                                color: "#ffffff",
                                            }}
                                        >
                                            {showCachedVersions ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                    {showCachedVersions && (
                                        <ul style={{ listStyleType: "none", padding: 0 }}>
                                            {cachedVersions.map((version, index) => (
                                                <li
                                                    key={index}
                                                    style={{
                                                        marginTop: "5px",
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                    }}
                                                >
                                                    <button
                                                        style={{
                                                            padding: "5px",
                                                            backgroundColor: "#2d2d2d",
                                                            color: "#ffffff",
                                                            width: "calc(100% - 30px)",
                                                            textAlign: "center",
                                                        }}
                                                    >
                                                        {version}
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            const cache = await caches.open("wasm-cache");
                                                            await cache.delete(`/${version}`);
                                                            fetchCachedVersions();
                                                        }}
                                                        style={{
                                                            padding: "5px",
                                                            backgroundColor: "#a10a0aff",
                                                            color: "#ffffff",
                                                            display: "flex",
                                                            justifyContent: "center",
                                                            alignItems: "center",
                                                            marginLeft: "5px",
                                                        }}
                                                    >
                                                        X
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            )}
                            <li style={{ marginTop: "10px" }}>
                                <label
                                    htmlFor="file-upload"
                                    style={{
                                        padding: "5px 5px 5px 5px",
                                        backgroundColor: "#2d2d2d",
                                        color: "#ffffff",
                                        width: "100%",
                                        textAlign: "center",
                                        cursor: "pointer",
                                    }}
                                >
                                    Upload Files
                                </label>
                                <input
                                    id="file-upload"
                                    type="file"
                                    multiple
                                    onChange={handleUploadInput}
                                    style={{ display: "none" }}
                                />
                            </li>
                        </ul>
                    </div>
                )}
                {!sidebarOpen && (
                    <button
                        onClick={() => setSidebarOpen(true)}
                        style={{
                            position: "fixed",
                            left: "10px",
                            top: "10px",
                            zIndex: 1000,
                            backgroundColor: "#2d2d2d",
                            color: "#ffffff",
                        }}
                    >
                        ☰
                    </button>
                )}
                <div style={{ minHeight: "100vh", width: "100%" }}>
                    {tabs.map((id) => {
                        if (!tabRefs.current[id]) tabRefs.current[id] = createRef<R2TabHandle>();
                        const ref = tabRefs.current[id];
                        return (
                            <R2Tab key={id} ref={ref} pkg={pkg} file={file} active={id === activeTab} />
                        );
                    })}
                    {tabs.length === 0 && (
                        <div style={{ color: '#ccc', padding: '1rem' }}>No tabs open</div>
                    )}
                <div ref={terminalRef} style={{ height: "100vh", width: "100%" }} />
                </div>
            </div>
        </>
    );
}
