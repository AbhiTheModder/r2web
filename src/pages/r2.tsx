import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { fileStore } from "../store/FileStore";
import wasmerSDKModule from "@wasmer/sdk/wasm?url";
import "xterm/css/xterm.css";
import { Directory, type Instance, type Wasmer } from "@wasmer/sdk";

export default function Radare2Terminal() {
    const terminalRef = useRef<HTMLDivElement>(null);
    const [termInstance, setTermInstance] = useState<Terminal | null>(null);
    const [_, setFitAddon] = useState<FitAddon | null>(null);
    const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
    const [wasmerInitialized, setWasmerInitialized] = useState(false);
    const [pkg, setPkg] = useState<Wasmer | null>(null);
    const [wasmUrl, setWasmUrl] = useState(
        "https://radareorg.github.io/r2wasm/radare2.wasm?v=6.0.0"
    );
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [r2Writer, setr2Writer] = useState<
        WritableStreamDefaultWriter<any> | undefined
    >(undefined);
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
    async function fetchCachedVersions() {
        const cache = await caches.open("wasm-cache");
        const keys = await cache.keys();
        // console.log("Cached versions:", keys);
        setCachedVersions(keys.map((request) => new URL(request.url).pathname.replace("/", "")));
    }
    fetchCachedVersions();
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, dir: Directory) => {
        if (!event.target.files) return;

        const files = Array.from(event.target.files);
        await Promise.all(
            files.map(async (file) => {
                const arrayBuffer = await file.arrayBuffer();
                await dir.writeFile(`/${file.name}`, new Uint8Array(arrayBuffer));
                console.log(`File ${file.name} uploaded to /${file.name}`);
            })
        );
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
            if (termInstance) {
                termInstance.dispose();
            }
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
                    mydir
                },
            });

            connectStreams(instance, termInstance!);
        }

        runRadare2();
    }, [termInstance, pkg]);

    function connectStreams(instance: Instance, term: Terminal) {
        const encoder = new TextEncoder();
        const stdin = instance.stdin?.getWriter();
        setr2Writer(stdin);

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

    const handleSearch = () => {
        if (!searchAddon || !searchTerm) return;

        searchAddon.findNext(searchTerm, {
            caseSensitive: searchCaseSensitive,
            regex: searchRegex,
        });
    };

    const handleSearchPrevious = () => {
        if (!searchAddon || !searchTerm) return;

        searchAddon.findPrevious(searchTerm, {
            caseSensitive: searchCaseSensitive,
            regex: searchRegex,
        });
    };

    const file = fileStore.getFile();
    const isFileSelected = file !== null;

    return (
        <>
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
                            <li>
                                <button
                                    onClick={() => {
                                        if (!isFileSelected) return;
                                        const encoder = new TextEncoder();
                                        r2Writer?.write(encoder.encode('?e "\\ec"'));
                                        r2Writer?.write(encoder.encode("\r"));
                                        r2Writer?.write(encoder.encode("pd"));
                                        r2Writer?.write(encoder.encode("\r"));
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
                                        r2Writer?.write(encoder.encode('?e "\\ec"'));
                                        r2Writer?.write(encoder.encode("\r"));
                                        r2Writer?.write(encoder.encode("pdc"));
                                        r2Writer?.write(encoder.encode("\r"));
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
                                        r2Writer?.write(encoder.encode('?e "\\ec"'));
                                        r2Writer?.write(encoder.encode("\r"));
                                        r2Writer?.write(encoder.encode("px"));
                                        r2Writer?.write(encoder.encode("\r"));
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
                                        r2Writer?.write(encoder.encode('?e "\\ec"'));
                                        r2Writer?.write(encoder.encode("\r"));
                                        r2Writer?.write(encoder.encode("iz"));
                                        r2Writer?.write(encoder.encode("\r"));
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
                                                <li key={index} style={{ marginTop: "5px", display: "flex", justifyContent: "space-between" }}>
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
                                    onChange={(event) => {
                                        if (dir) {
                                            handleFileUpload(event, dir);
                                        }
                                    }}
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
                <div ref={terminalRef} style={{ minHeight: "100vh", width: "100%" }} />
            </div>
        </>
    );
}
