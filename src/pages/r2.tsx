import { useEffect, useRef, useState, createRef } from "react";
import { fileStore } from "../store/FileStore";
import wasmerSDKModule from "@wasmer/sdk/wasm?url";
import "xterm/css/xterm.css";
import { type Wasmer } from "@wasmer/sdk";
import { R2Tab, type R2TabHandle } from "../r2tab";


export default function Radare2Terminal() {
    const [pkg, setPkg] = useState<Wasmer | null>(null);
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
    const [currentVersion, setCurrentVersion] = useState<string>("");

    // Tabs state
    const [tabs, setTabs] = useState<number[]>([0]);
    const [activeTab, setActiveTab] = useState(0);
    const tabRefs = useRef<Record<number, React.RefObject<R2TabHandle | null>>>({});
    if (!tabRefs.current[0]) tabRefs.current[0] = createRef<R2TabHandle | null>();

    async function fetchCachedVersions() {
        const cache = await caches.open("wasm-cache");
        const keys = await cache.keys();
        // console.log("Cached versions:", keys);
        setCachedVersions(keys.map((request) => new URL(request.url).pathname.replace("/", "")));
    }
    fetchCachedVersions();

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const version = urlParams.get("version") || "6.0.3";
        setCurrentVersion(version);
        const doCache = urlParams.get("cache") === "true";
        async function initializeWasmer() {
            const { Wasmer, init } = await import("@wasmer/sdk");
            await init({ module: wasmerSDKModule });

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
            const wasmUrl = version === "6.0.3"
                ? "https://radareorg.github.io/r2wasm/radare2.wasm"
                : import.meta.env.MODE === "production"
                    ? `https://${import.meta.env.VITE_VERCEL_PROJECT_PRODUCTION_URL}/api/vercel?version=${version}`
                    : `http://localhost:3000/wasm/${version}`;
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

        return () => { };
    }, []);

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

    useEffect(() => {
        const ref = tabRefs.current[activeTab]?.current;
        ref?.focus();
    }, [activeTab]);

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

    useEffect(() => {
        if (window.innerWidth < 768) {
            setSidebarOpen(false);
        }
    }, []);

    return (
        <>
            {/* Global reset to fill viewport and prevent Safari bounce */}
            <style>{`
                html, body, #root { height: 100%; margin: 0; padding: 0; overflow: hidden; }
                html, body { margin: 0; padding: 0; background: #1e1e1e; overscroll-behavior: none; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
                /* Prevent page scroll/rubber-band; we scroll inside .app-root instead */
                body { position: fixed; inset: 0; overflow: hidden; }
                .app-root { height: 100vh; width: 100vw; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }

                /* Button styles */
                .app-root button, .app-root label[htmlFor="file-upload"] {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 8px 12px !important;
                    background: linear-gradient(180deg, #2f2f35, #242427) !important;
                    color: #fff !important;
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
                    box-shadow: 0 6px 18px rgba(0,0,0,0.45);
                    text-align: center;
                }
                .app-root button:hover:not(:disabled), .app-root label[htmlFor="file-upload"]:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 10px 24px rgba(0,0,0,0.5);
                    background: linear-gradient(180deg, #3b82f6, #2563eb) !important;
                }
                .app-root button:active:not(:disabled) {
                    transform: translateY(0);
                }
                .app-root button:disabled {
                    opacity: 0.45;
                    cursor: not-allowed;
                    box-shadow: none;
                    background: linear-gradient(180deg, #2d2d2d, #262626) !important;
                }
                .app-root .danger {
                    background: linear-gradient(180deg, #ff5f6d, #ef4444) !important;
                    border: 1px solid rgba(255,0,0,0.15);
                }
                .app-root .ghost {
                    background: transparent !important;
                    border: 1px solid rgba(255,255,255,0.08);
                    box-shadow: none;
                }
                /* Small icon button */
                .app-root .icon-btn {
                    padding: 6px 8px !important;
                    border-radius: 6px;
                    font-weight: 600;
                    min-width: 36px;
                }

                .app-root .tab-button {
                    background: none !important;
                    box-shadow: none !important;
                }
                .app-root .tab-button.active {
                    background-color: #485a76ff !important;
                }
                .app-root .tab-button.inactive {
                    background-color: #1c1c1c !important;
                }

                /* Make inputs match theme */
                .app-root input[type="text"] {
                    padding: 6px 8px;
                    background: #2d2d2d;
                    color: #fff;
                    border-radius: 6px;
                    border: none;
                }
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
                            objectFit: "contain",
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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Tabs bar */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    height: '36px', padding: '4px 6px',
                    backgroundColor: '#111', color: '#fff',
                    overflowX: 'auto',
                    borderBottom: '1px solid #333',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        {tabs.map((id, i) => (
                            <button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                className={`tab-button ${id === activeTab ? 'active' : 'inactive'}`}
                                style={{
                                    whiteSpace: 'nowrap',
                                    maxWidth: '160px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    color: '#fff',
                                    border: '1px solid #333',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
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
                <div className="app-root" style={{ position: 'relative', display: 'flex', flex: 1 }}>
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: "flex",
                            width: "100%",
                            transition: "0.3s",
                            backgroundColor: "#1e1e1e",
                        }}
                    >
                        {sidebarOpen && (
                            <div
                                style={{ padding: "10px", overflowY: "auto", overflowX: "hidden", color: "#ffffff" }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                    }}
                                >
                                    <h3>r2web</h3>
                                    <button
                                        className="icon-btn"
                                        onClick={() => setSidebarOpen(false)}
                                    >
                                        ×
                                    </button>
                                </div>
                                <ul style={{ listStyleType: "none", padding: 0 }}>
                                    <li style={{ marginBottom: "8px" }}>
                                        <button
                                            onClick={() => {
                                                const ref = tabRefs.current[activeTab]?.current;
                                                if (ref && file) ref.restartSession?.();
                                            }}
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
                                                const writer = getActiveWriter();
                                                const encoder = new TextEncoder();
                                                if (writer) {
                                                    writer?.write(encoder.encode('?e "\\ec"'));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode("pd"));
                                                    writer?.write(encoder.encode("\r"));
                                                }
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
                                                const writer = getActiveWriter();
                                                const encoder = new TextEncoder();
                                                if (writer) {
                                                    writer?.write(encoder.encode('?e "\\ec"'));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode("pdc"));
                                                    writer?.write(encoder.encode("\r"));
                                                }
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
                                                const writer = getActiveWriter();
                                                const encoder = new TextEncoder();
                                                if (writer) {
                                                    writer?.write(encoder.encode('?e "\\ec"'));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode("px"));
                                                    writer?.write(encoder.encode("\r"));
                                                }
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
                                                const writer = getActiveWriter();
                                                const encoder = new TextEncoder();
                                                if (writer) {
                                                    writer?.write(encoder.encode('?e "\\ec"'));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode("iz"));
                                                    writer?.write(encoder.encode("\r"));
                                                }
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
                                                                className="danger" style={{ padding: "5px", display: "flex", justifyContent: "center", alignItems: "center", marginLeft: "5px" }}
                                                            >
                                                                X
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    )}
                                    {currentVersion >= "6.0.3" && (<li>
                                        <button
                                            onClick={async () => {
                                                if (!isFileSelected) return;
                                                const writer = getActiveWriter();
                                                const encoder = new TextEncoder();
                                                if (writer) {
                                                    writer?.write(encoder.encode('?e "\\ec"'));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode(`wcf mydir/${file.name.split(".").slice(0, -1).join(".")}_m.${file.name.split(".").pop()}`));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode('?e "\\ec"'));
                                                    writer?.write(encoder.encode("\r"));
                                                    writer?.write(encoder.encode("?e [I] Saving file..."));
                                                    writer?.write(encoder.encode("\r"));
                                                    // saving takes a lil bit of time so we wait for it to finish
                                                    await new Promise((resolve) => setTimeout(resolve, 1000));
                                                    const ref = tabRefs.current[activeTab]?.current;
                                                    const dir = ref?.getDir();

                                                    if (dir) {
                                                        // const entries = await dir.readDir(".");
                                                        // console.log(entries);
                                                        const bytes = await dir.readFile(`/${file.name.split(".").slice(0, -1).join(".")}_m.${file.name.split(".").pop()}`);
                                                        console.log(bytes);
                                                        const blob = new Blob([bytes], { type: "application/octet-stream" });
                                                        const url = URL.createObjectURL(blob);
                                                        const a = document.createElement("a");
                                                        a.href = url;
                                                        a.download = `${file.name.split(".").slice(0, -1).join(".")}_m.${file.name.split(".").pop()}`;
                                                        a.click();
                                                        URL.revokeObjectURL(url);
                                                        writer?.write(encoder.encode('?e "\\ec"'));
                                                        writer?.write(encoder.encode("\r"));
                                                        writer?.write(encoder.encode("?e [S] File saved successfully!"));
                                                        writer?.write(encoder.encode("\r"));
                                                    }
                                                }
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
                                            Save File
                                        </button>
                                    </li>)}
                                </ul>
                                <div style={{ display: "flex", justifyContent: "center", marginTop: "10px" }}>
                                    <button
                                        type="button"
                                        onClick={() => document.getElementById("file-upload")?.click()}
                                        style={{
                                            padding: "5px 5px 5px 5px",
                                            backgroundColor: "#2d2d2d",
                                            color: "#ffffff",
                                            width: "100%",
                                            textAlign: "center",
                                            cursor: "pointer",
                                            border: "none",
                                            borderRadius: "4px",
                                        }}
                                    >
                                        Upload Files
                                    </button>
                                    <input
                                        id="file-upload"
                                        type="file"
                                        multiple
                                        onChange={(event) => {
                                            const ref = tabRefs.current[activeTab]?.current;
                                            if (ref) {
                                                if (event.target.files) {
                                                    ref.uploadFiles(event.target.files);
                                                }
                                            }
                                        }}
                                        style={{ display: "none" }}
                                    />
                                </div>
                            </div>
                        )}
                        {!sidebarOpen && (
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="icon-btn" style={{ position: "fixed", left: "10px", top: "10px", zIndex: 1000 }}
                            >
                                ☰
                            </button>
                        )}
                        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                            {tabs.map((id) => {
                                if (!tabRefs.current[id]) tabRefs.current[id] = createRef<R2TabHandle>();
                                return (
                                    <R2Tab
                                        key={id}
                                        ref={tabRefs.current[id]}
                                        pkg={pkg}
                                        file={fileStore.getFile()}
                                        active={id === activeTab}
                                    />
                                );
                            })}
                            {tabs.length === 0 && (
                                <div style={{ color: '#ccc', padding: '1rem' }}>No tabs open</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
