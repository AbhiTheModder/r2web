import { useEffect, useRef, useState, createRef } from "react";
import { fileStore } from "../store/FileStore";
import wasmerSDKModule from "@wasmer/sdk/wasm?url";
import "xterm/css/xterm.css";
import { type Wasmer, type Directory } from "@wasmer/sdk";
import { R2Tab, type R2TabHandle } from "../r2tab";
import { useNavigate } from "react-router-dom";
import { StringsView } from "../views/StringsView";
import { HexView, type HexLine } from "../views/HexView";
import { CFGView } from "../views/CFGView";
import { CodeEditorView } from "../views/CodeEditorView";

const HomeIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={style}
    >
        <path
            d="M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z"
            fill="currentColor"
        />
    </svg>
);

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
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [showStringsView, setShowStringsView] = useState(false);
    const [stringsData, setStringsData] = useState<any[]>([]);
    const [showHexView, setShowHexView] = useState(false);
    const [hexData, setHexData] = useState<HexLine[]>([]);
    const [showGraphView, setShowGraphView] = useState(false);
    const [graphData, setGraphData] = useState<any>(null);
    const [showScriptConfirm, setShowScriptConfirm] = useState(false);
    const [scriptFiles, setScriptFiles] = useState<File[]>([]);
    const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
    const [showCodeEditor, setShowCodeEditor] = useState(false);
    const [codeEditorFullscreen, setCodeEditorFullscreen] = useState(false);
    const [codeEditorRefreshKey, setCodeEditorRefreshKey] = useState(0);
    const [isMobile, setIsMobile] = useState(false);
    const navigate = useNavigate();

    // Tabs state
    const [tabs, setTabs] = useState<number[]>([0]);
    const [activeTab, setActiveTab] = useState(0);
    const tabRefs = useRef<Record<number, React.RefObject<R2TabHandle | null>>>(
        {},
    );
    const fileInputRef = useRef<HTMLInputElement>(null);
    if (!tabRefs.current[0])
        tabRefs.current[0] = createRef<R2TabHandle | null>();

    async function fetchCachedVersions() {
        const cache = await caches.open("wasm-cache");
        const keys = await cache.keys();
        // console.log("Cached versions:", keys);
        setCachedVersions(
            keys.map((request) =>
                new URL(request.url).pathname.replace("/", ""),
            ),
        );
    }
    fetchCachedVersions();

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const version = urlParams.get("version") || "6.1.8";
        setCurrentVersion(version);
        const doCache = urlParams.get("cache") === "true";
        async function initializeWasmer() {
            const { Wasmer, init } = await import("@wasmer/sdk");
            await init({ module: wasmerSDKModule });

            if (version === "custom") {
                const customWasm = fileStore.getCustomWasm();
                if (customWasm) {
                    const packageInstance = Wasmer.fromWasm(customWasm);
                    setPkg(packageInstance);
                    return;
                }
            }

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
            const wasmUrl =
                version === "6.1.8"
                    ? "https://radareorg.github.io/r2wasm/radare2.wasm"
                    : import.meta.env.MODE === "production" &&
                      import.meta.env.VITE_VERCEL_PROJECT_PRODUCTION_URL
                      ? `https://${import.meta.env.VITE_VERCEL_PROJECT_PRODUCTION_URL}/api/vercel?version=${version}`
                      : import.meta.env.VITE_VERCEL_URL ? `https://${import.meta.env.VITE_VERCEL_URL}/api/vercel?version=${version}`
                        : import.meta.env.VITE_WASM_SERVER
                          ? `${import.meta.env.VITE_WASM_SERVER.replace(/\/$/, "")}/wasm/${version}`
                        : `/wasm/${version}`;
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
                        const progress = Math.min(
                            30 + (loaded / total) * 50,
                            80,
                        );
                        setDownloadProgress(progress);
                    }
                }
            }

            setDownloadPhase("processing");
            setDownloadProgress(85);

            const totalLength = chunks.reduce(
                (sum, chunk) => sum + chunk.length,
                0,
            );
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
            tabs.forEach((id) => {
                const ref = tabRefs.current[id]?.current;
                ref?.dispose();
            });
        };
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

    const handleShowStrings = async () => {
        if (!isFileSelected) return;
        const writer = getActiveWriter();
        const encoder = new TextEncoder();
        const ref = tabRefs.current[activeTab]?.current;
        const dir = ref?.getDir();

        if (writer && dir) {
            writer.write(encoder.encode('?e "\\ec"'));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("?e [I] Loading..."));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("izj > mydir/.strings"));
            writer.write(encoder.encode("\r"));

            setTimeout(async () => {
                try {
                    const bytes = await dir.readFile("/.strings");
                    const jsonString = new TextDecoder().decode(bytes);
                    const parsedStrings = JSON.parse(jsonString);
                    setStringsData(parsedStrings);
                    await dir.removeFile("/.strings");
                    setShowStringsView(true);
                } catch (error) {
                    console.error("Error reading strings file:", error);
                }
            }, 1000);
        }
    };

    const parseHexdump = (output: string): HexLine[] => {
        const lines: HexLine[] = [];
        const linesArray = output.split("\n").filter((line) => line.trim());

        for (const line of linesArray) {
            if (!line.startsWith("0x")) {
                continue;
            }

            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;

            const offset = parts[0];
            const bytes: string[] = [];
            let ascii = "";

            for (let i = 1; i < parts.length; i++) {
                const hexGroup = parts[i];

                if (/^[0-9a-fA-F]+$/.test(hexGroup) && hexGroup.length >= 2) {
                    for (let j = 0; j < hexGroup.length; j += 2) {
                        const byte = hexGroup.substring(j, j + 2);
                        if (byte.length === 2) {
                            bytes.push(byte);
                        }
                    }
                } else if (/^[ -~]+$/.test(hexGroup)) {
                    ascii += hexGroup + " ";
                }
            }

            ascii = ascii.trim();

            const offsetNum = parseInt(offset, 16);

            if (bytes.length === 16) {
                lines.push({
                    offset,
                    offsetNum,
                    bytes,
                    ascii,
                });
            }
        }

        return lines;
    };

    const handleShowHexdump = async () => {
        if (!isFileSelected) return;
        const writer = getActiveWriter();
        const encoder = new TextEncoder();
        const ref = tabRefs.current[activeTab]?.current;
        const dir = ref?.getDir();

        if (writer && dir) {
            writer.write(encoder.encode('?e "\\ec"'));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("?e [I] Loading..."));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("px > mydir/.hexdump"));
            writer.write(encoder.encode("\r"));

            setTimeout(async () => {
                try {
                    const bytes = await dir.readFile("/.hexdump");
                    const output = new TextDecoder().decode(bytes);
                    const parsedHex = parseHexdump(output);
                    setHexData(parsedHex);
                    await dir.removeFile("/.hexdump");
                    setShowHexView(true);
                } catch (error) {
                    console.error("Error reading hexdump file:", error);
                }
            }, 1000);
        }
    };

    const handleShowGraph = async () => {
        if (!isFileSelected) return;
        const writer = getActiveWriter();
        const encoder = new TextEncoder();
        const ref = tabRefs.current[activeTab]?.current;
        const dir = ref?.getDir();

        if (writer && dir) {
            writer.write(encoder.encode('?e "\\ec"'));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("aa"));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("clear\r"));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("?e [I] Loading..."));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode("agfj > mydir/.graph"));
            writer.write(encoder.encode("\r"));

            setTimeout(async () => {
                try {
                    const bytes = await dir.readFile("/.graph");
                    const jsonString = new TextDecoder().decode(bytes);
                    const jsonData = JSON.parse(jsonString);
                    setGraphData(jsonData);
                    await dir.removeFile("/.graph");
                    setShowGraphView(true);
                } catch (error) {
                    if (error instanceof Error && error.message.includes("entry not found")) {
                        writer.write(encoder.encode("clear\r"));
                        writer.write(encoder.encode("[E] No function found at current address"));
                        writer.write(encoder.encode("\r"));
                    } else {
                        console.error("Error reading graph file:", error);
                    }
                }
            }, 1000);
        }
    };

    const handleNavigateHome = async () => {
        tabs.forEach(async (id) => {
            const ref = tabRefs.current[id]?.current;
            ref?.dispose();
        });

        if (pkg) {
            setPkg(null);
        }

        setStringsData([]);
        setHexData([]);
        setGraphData(null);

        tabRefs.current = {};

        navigate("/");
    };

    const file = fileStore.getFile();
    const isFileSelected = file !== null;

    function getActiveWriter() {
        const ref = tabRefs.current[activeTab]?.current;
        return ref?.getWriter();
    }

    function getActiveDir(): Directory | null {
        const ref = tabRefs.current[activeTab]?.current;
        return ref?.getDir() || null;
    }

    const handleSeekAddress = (address: string) => {
        const writer = getActiveWriter();
        const encoder = new TextEncoder();
        if (writer) {
            if (showHexView) {
                setShowHexView(false);
            }
            if (showStringsView) {
                setShowStringsView(false);
            }
            writer.write(encoder.encode("clear\r"));
            writer.write(encoder.encode("\r"));
            writer.write(encoder.encode(`s @ ${address}`));
            writer.write(encoder.encode("\r"));
        }
    };

    const isR2Script = (fileName: string): boolean => {
        return fileName.endsWith('.r2.js') || fileName.endsWith('.r2');
    };

    const handleFileUpload = async (files: FileList) => {
        const fileArray = Array.from(files);
        const r2Scripts = fileArray.filter(f => isR2Script(f.name));

        if (r2Scripts.length > 0) {
            setPendingFiles(files);
            setScriptFiles(r2Scripts);
            setShowScriptConfirm(true);
            return;
        }

        const ref = tabRefs.current[activeTab]?.current;
        if (ref) {
            await ref.uploadFiles(files);
            setCodeEditorRefreshKey(prev => prev + 1);
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleScriptConfirm = async () => {
        setShowScriptConfirm(false);

        const ref = tabRefs.current[activeTab]?.current;
        if (!ref || !pendingFiles) return;

        await ref.uploadFiles(pendingFiles);

        const writer = ref.getWriter();
        const encoder = new TextEncoder();
        if (writer) {
            for (const script of scriptFiles) {
                const command = `. /mydir/${script.name}`;
                writer.write(encoder.encode(command));
                writer.write(encoder.encode("\r"));
            }
        }

        setCodeEditorRefreshKey(prev => prev + 1);
        setPendingFiles(null);
        setScriptFiles([]);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleRunScript = async (filename: string) => {
        const ref = tabRefs.current[activeTab]?.current;
        if (!ref) return;
        const writer = ref.getWriter();
        if (writer) {
            const command = `. /mydir/${filename}`;
            const encoder = new TextEncoder();
            writer.write(encoder.encode(command));
            writer.write(encoder.encode("\r"));
            ref.focus();
        }
    };

    const handleScriptCancel = async () => {
        setShowScriptConfirm(false);
        const ref = tabRefs.current[activeTab]?.current;
        if (ref && pendingFiles) {
            await ref.uploadFiles(pendingFiles);
            setCodeEditorRefreshKey(prev => prev + 1);
        }
        setPendingFiles(null);
        setScriptFiles([]);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };
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
            if (
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            )
                return;
            if (e.key === "Escape") {
                if (showHexView) {
                    setShowHexView(false);
                    return;
                }
                if (showStringsView) {
                    setShowStringsView(false);
                    return;
                }
                if (showGraphView) {
                    setShowGraphView(false);
                    return;
                }
                if (showShortcuts) {
                    setShowShortcuts(false);
                    return;
                }
            }
            if (e.altKey) {
                if (e.code.startsWith("Digit")) {
                    const num = parseInt(e.code.replace("Digit", ""), 10);
                    if (num >= 1 && num <= 9) {
                        e.preventDefault();
                        const idx = Math.min(num - 1, tabs.length - 1);
                        setActiveTab(tabs[idx]);
                    }
                } else if (e.code === "ArrowRight") {
                    e.preventDefault();
                    const order = tabs;
                    const curIndex = order.indexOf(activeTab);
                    const next = order[(curIndex + 1) % order.length];
                    setActiveTab(next);
                } else if (e.code === "ArrowLeft") {
                    e.preventDefault();
                    const order = tabs;
                    const curIndex = order.indexOf(activeTab);
                    const next =
                        order[(curIndex - 1 + order.length) % order.length];
                    setActiveTab(next);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tabs, activeTab, showHexView, showStringsView, showGraphView, showShortcuts]);

    useEffect(() => {
        if (!pkg || currentVersion !== "custom") return;
        const timer = setTimeout(async () => {
            const ref = tabRefs.current[0]?.current;
            const writer = ref?.getWriter();
            const dir = ref?.getDir();
            if (writer && dir) {
                const encoder = new TextEncoder();
                writer.write(encoder.encode("?V > mydir/.r2version"));
                writer.write(encoder.encode("\r"));
                await new Promise(r => setTimeout(r, 500));
                try {
                    const bytes = await dir.readFile("/.r2version");
                    const ver = new TextDecoder().decode(bytes).trim();
                    const semverMatch = ver.match(/\d+\.\d+\.\d+/);
                    setCurrentVersion(semverMatch ? semverMatch[0] : ver);
                    await dir.removeFile("/.r2version");
                } catch {}
            }
        }, 1500);
        return () => clearTimeout(timer);
    }, [pkg]);

    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);
            if (mobile) {
                setSidebarOpen(false);
            } else {
                setSidebarOpen(true);
            }
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
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

                .shortcuts-modal {
                    position: fixed;
                    inset: 50% auto auto 50%;
                    transform: translate(-50%, -50%);
                    background: #1e1e1e;
                    padding: 20px;
                    border-radius: 12px;
                    border: 1px solid #333;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                    z-index: 1001;
                    color: #fff;
                    max-width: 90vw;
                    max-height: 90vh;
                    overflow-y: auto;
                }
                .shortcuts-backdrop {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.5);
                    z-index: 1000;
                }
                .shortcuts-grid {
                    display: grid;
                    grid-template-columns: auto auto;
                    gap: 12px;
                    margin-top: 16px;
                }
                .shortcuts-grid div {
                    display: contents;
                }
                .shortcuts-grid span:first-child {
                    color: #888;
                }
                .shortcuts-grid span:last-child {
                    font-family: monospace;
                    background: #333;
                    padding: 2px 6px;
                    border-radius: 4px;
                }
            `}</style>

            {showShortcuts && (
                <>
                    <div
                        className="shortcuts-backdrop"
                        onClick={() => setShowShortcuts(false)}
                    />
                    <div className="shortcuts-modal">
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "16px",
                            }}
                        >
                            <h3 style={{ margin: 0 }}>Keyboard Shortcuts</h3>
                            <button
                                className="icon-btn ghost"
                                onClick={() => setShowShortcuts(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className="shortcuts-grid">
                            <div>
                                <span>Switch to tab</span>
                                <span>Alt + 1-9</span>
                            </div>
                            <div>
                                <span>Next tab</span>
                                <span>Alt + →</span>
                            </div>
                            <div>
                                <span>Previous tab</span>
                                <span>Alt + ←</span>
                            </div>
                            <div>
                                <span>Copy/Cancel text/operation</span>
                                <span>Ctrl + C</span>
                            </div>
                            <div>
                                <span>Paste from clipboard</span>
                                <span>Ctrl + V</span>
                            </div>
                            <div>
                                <span>Restart session</span>
                                <span>Ctrl + R</span>
                            </div>
                            <div>
                                <span>Clear terminal</span>
                                <span>Ctrl + L</span>
                            </div>
                            <div>
                                <span>Search</span>
                                <span>Ctrl + F</span>
                            </div>
                            <div>
                                <span>Go to address</span>
                                <span>Ctrl + G</span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {showScriptConfirm && (
                <>
                    <div
                        className="shortcuts-backdrop"
                        onClick={handleScriptCancel}
                    />
                    <div className="shortcuts-modal">
                        <h3 style={{ margin: 0, marginBottom: "16px" }}>
                            R2 Script Detected
                        </h3>
                        <p style={{ marginBottom: "16px", color: "#ccc" }}>
                            You just chose {scriptFiles.length > 1 ? 'files which seem' : 'a file which seems'}
                            like {scriptFiles.length > 1 ? 'r2 scripts' : 'an r2 script'}. Would you like to load {scriptFiles.length > 1 ? 'them' : 'it'}?
                        </p>
                        <div style={{ marginBottom: "12px", color: "#888", fontSize: "0.9rem" }}>
                            {scriptFiles.map(f => (
                                <div key={f.name} style={{ padding: "4px 8px", background: "#2a2a2a", marginBottom: "4px", borderRadius: "4px" }}>
                                    {f.name}
                                </div>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button
                                className="ghost"
                                onClick={handleScriptCancel}
                                style={{ padding: "6px 12px" }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleScriptConfirm}
                                style={{ padding: "6px 12px" }}
                            >
                                Load Script{scriptFiles.length > 1 ? 's' : ''}
                            </button>
                        </div>
                    </div>
                </>
            )}

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
                        src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/r2.png`}
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
                        {downloadPhase === "initializing" &&
                            "Initializing Radare2..."}
                        {downloadPhase === "downloading" &&
                            "Downloading Radare2..."}
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
                                    downloadPhase === "complete"
                                        ? "#27ae60"
                                        : "#3498db",
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
                        {downloadPhase === "initializing" &&
                            "Setting up runtime..."}
                        {downloadPhase === "downloading" &&
                            "Downloading radare2 (will not download again in future)..."}
                        {downloadPhase === "processing" &&
                            "Initializing radare2 instance..."}
                        {downloadPhase === "complete" &&
                            "Radare2 is ready to use!"}
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
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                }}
            >
                {/* Tabs bar */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        height: "36px",
                        padding: "4px 6px",
                        backgroundColor: "#111",
                        color: "#fff",
                        overflowX: "auto",
                        borderBottom: "1px solid #333",
                        flexShrink: 0,
                    }}
                >
                    <div style={{ display: "flex", gap: "6px" }}>
                        {tabs.map((id, i) => (
                            <button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                className={`tab-button ${id === activeTab ? "active" : "inactive"}`}
                                style={{
                                    whiteSpace: "nowrap",
                                    maxWidth: "160px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    padding: "6px 10px",
                                    borderRadius: "6px",
                                    color: "#fff",
                                    border: "1px solid #333",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }}
                            >
                                <span
                                    style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        flex: 1,
                                    }}
                                >
                                    {`${i + 1}`}
                                    {file ? `: ${file.name}` : ""}
                                </span>
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const ref =
                                            tabRefs.current[id]?.current;
                                        ref?.dispose();
                                        setTabs((prev) => {
                                            const idx = prev.indexOf(id);
                                            const remaining = prev.filter(
                                                (tid) => tid !== id,
                                            );
                                            if (activeTab === id) {
                                                const nextActive =
                                                    remaining.length
                                                        ? remaining[
                                                              Math.max(
                                                                  0,
                                                                  idx - 1,
                                                              )
                                                          ]
                                                        : -1;
                                                setActiveTab(nextActive);
                                            }
                                            return remaining;
                                        });
                                    }}
                                    style={{ cursor: "pointer", opacity: 0.8 }}
                                >
                                    ×
                                </span>
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => {
                            setTabs((prev) => {
                                const nextId = prev.length
                                    ? Math.max(...prev) + 1
                                    : 0;
                                const newArr = [...prev, nextId];
                                if (!tabRefs.current[nextId])
                                    tabRefs.current[nextId] =
                                        createRef<R2TabHandle>();
                                setActiveTab(nextId);
                                return newArr;
                            });
                        }}
                        style={{
                            marginLeft: "auto",
                            padding: "6px 10px",
                            borderRadius: "6px",
                            backgroundColor: "#1c1c1c",
                            color: "#fff",
                            border: "1px solid #333",
                        }}
                    >
                        +
                    </button>
                </div>
                <div
                    className="app-root"
                    style={{ position: "relative", display: "flex", flex: 1 }}
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            width: "100%",
                            transition: "0.3s",
                            backgroundColor: "#1e1e1e",
                        }}
                    >
                        {sidebarOpen && (
                            <div
                                style={{
                                    padding: "10px",
                                    overflowY: "auto",
                                    overflowX: "hidden",
                                    color: "#ffffff",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                    }}
                                >
                                    <button
                                        onClick={handleNavigateHome}
                                        className="icon-btn"
                                    >
                                        <HomeIcon
                                            style={{
                                                width: "20px",
                                                height: "20px",
                                            }}
                                        />
                                    </button>
                                    <h3 style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                                        {currentVersion ? `r2 ${currentVersion}` : 'r2web'}
                                    </h3>
                                    <button
                                        className="icon-btn"
                                        onClick={() => setSidebarOpen(false)}
                                    >
                                        ×
                                    </button>
                                </div>
                                <ul
                                    style={{
                                        listStyleType: "none",
                                        padding: 0,
                                    }}
                                >
                                    <li style={{ marginBottom: "8px" }}>
                                        <button
                                            onClick={() => {
                                                const ref =
                                                    tabRefs.current[activeTab]
                                                        ?.current;
                                                if (ref && file)
                                                    ref.restartSession?.();
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
                                                const writer =
                                                    getActiveWriter();
                                                const encoder =
                                                    new TextEncoder();
                                                if (writer) {
                                                    writer?.write(
                                                        encoder.encode(
                                                            '?e "\\ec"',
                                                        ),
                                                    );
                                                    writer?.write(
                                                        encoder.encode("\r"),
                                                    );
                                                    writer?.write(
                                                        encoder.encode("pd"),
                                                    );
                                                    writer?.write(
                                                        encoder.encode("\r"),
                                                    );
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
                                                const writer =
                                                    getActiveWriter();
                                                const encoder =
                                                    new TextEncoder();
                                                if (writer) {
                                                    writer?.write(
                                                        encoder.encode(
                                                            '?e "\\ec"',
                                                        ),
                                                    );
                                                    writer?.write(
                                                        encoder.encode("\r"),
                                                    );
                                                    writer?.write(
                                                        encoder.encode("pdc"),
                                                    );
                                                    writer?.write(
                                                        encoder.encode("\r"),
                                                    );
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
                                                if (currentVersion >= "6.0.9") {
                                                    handleShowHexdump();
                                                } else {
                                                    if (!isFileSelected) return;
                                                    const writer = getActiveWriter();
                                                    const encoder = new TextEncoder();
                                                    if (writer) {
                                                        writer?.write(
                                                            encoder.encode(
                                                                '?e "\\ec"',
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode("\r"),
                                                        );
                                                        writer?.write(
                                                            encoder.encode("px"),
                                                        );
                                                        writer?.write(
                                                            encoder.encode("\r"),
                                                        );
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
                                            Hexdump
                                        </button>
                                    </li>
                                    <li>
                                        <button
                                            onClick={() => {
                                                if (currentVersion >= "6.0.9") {
                                                    handleShowStrings();
                                                } else {
                                                    if (!isFileSelected) return;
                                                    const writer = getActiveWriter();
                                                    const encoder = new TextEncoder();
                                                    if (writer) {
                                                        writer?.write(
                                                            encoder.encode(
                                                                '?e "\\ec"',
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode("\r"),
                                                        );
                                                        writer?.write(
                                                            encoder.encode("iz"),
                                                        );
                                                        writer?.write(
                                                            encoder.encode("\r"),
                                                        );
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
                                            Strings
                                        </button>
                                    </li>
                                    {currentVersion >= "6.0.9" && (
                                        <li>
                                            <button
                                                onClick={handleShowGraph}
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
                                                Graph
                                            </button>
                                        </li>
                                    )}
                                    <li>
                                        <button
                                            onClick={() => setShowCodeEditor(true)}
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
                                            Code Editor
                                        </button>
                                    </li>
                                    <li style={{ marginTop: "10px" }}>
                                        <input
                                            type="text"
                                            value={searchTerm}
                                            onChange={(e) =>
                                                setSearchTerm(e.target.value)
                                            }
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
                                            <label
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        searchCaseSensitive
                                                    }
                                                    onChange={() =>
                                                        setSearchCaseSensitive(
                                                            !searchCaseSensitive,
                                                        )
                                                    }
                                                    style={{
                                                        marginRight: "5px",
                                                    }}
                                                />
                                                Case Sensitive
                                            </label>
                                            <label
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={searchRegex}
                                                    onChange={() =>
                                                        setSearchRegex(
                                                            !searchRegex,
                                                        )
                                                    }
                                                    style={{
                                                        marginRight: "5px",
                                                    }}
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
                                                    justifyContent:
                                                        "space-between",
                                                    alignItems: "center",
                                                }}
                                            >
                                                <span>Cached Versions:</span>
                                                <button
                                                    onClick={() =>
                                                        setShowCachedVersions(
                                                            !showCachedVersions,
                                                        )
                                                    }
                                                    style={{
                                                        padding: "5px",
                                                        backgroundColor:
                                                            "#2d2d2d",
                                                        color: "#ffffff",
                                                    }}
                                                >
                                                    {showCachedVersions
                                                        ? "Hide"
                                                        : "Show"}
                                                </button>
                                            </div>
                                            {showCachedVersions && (
                                                <ul
                                                    style={{
                                                        listStyleType: "none",
                                                        padding: 0,
                                                    }}
                                                >
                                                    {cachedVersions.map(
                                                        (version, index) => (
                                                            <li
                                                                key={index}
                                                                style={{
                                                                    marginTop:
                                                                        "5px",
                                                                    display:
                                                                        "flex",
                                                                    justifyContent:
                                                                        "space-between",
                                                                }}
                                                            >
                                                                <button
                                                                    style={{
                                                                        padding:
                                                                            "5px",
                                                                        backgroundColor:
                                                                            "#2d2d2d",
                                                                        color: "#ffffff",
                                                                        width: "calc(100% - 30px)",
                                                                        textAlign:
                                                                            "center",
                                                                    }}
                                                                >
                                                                    {version}
                                                                </button>
                                                                <button
                                                                    onClick={async () => {
                                                                        const cache =
                                                                            await caches.open(
                                                                                "wasm-cache",
                                                                            );
                                                                        await cache.delete(
                                                                            `/${version}`,
                                                                        );
                                                                        fetchCachedVersions();
                                                                    }}
                                                                    className="danger"
                                                                    style={{
                                                                        padding:
                                                                            "5px",
                                                                        display:
                                                                            "flex",
                                                                        justifyContent:
                                                                            "center",
                                                                        alignItems:
                                                                            "center",
                                                                        marginLeft:
                                                                            "5px",
                                                                    }}
                                                                >
                                                                    X
                                                                </button>
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}
                                        </li>
                                    )}
                                    {currentVersion >= "6.0.3" && (
                                        <li>
                                            <button
                                                onClick={async () => {
                                                    if (!isFileSelected) return;
                                                    const writer =
                                                        getActiveWriter();
                                                    const encoder =
                                                        new TextEncoder();
                                                    if (writer) {
                                                        writer?.write(
                                                            encoder.encode(
                                                                '?e "\\ec"',
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                "\r",
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                `wcf mydir/${file.name.split(".").slice(0, -1).join(".")}_m.${file.name.split(".").pop()}`,
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                "\r",
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                '?e "\\ec"',
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                "\r",
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                "?e [I] Saving file...",
                                                            ),
                                                        );
                                                        writer?.write(
                                                            encoder.encode(
                                                                "\r",
                                                            ),
                                                        );
                                                        // saving takes a lil bit of time so we wait for it to finish
                                                        await new Promise(
                                                            (resolve) =>
                                                                setTimeout(
                                                                    resolve,
                                                                    1000,
                                                                ),
                                                        );
                                                        const ref =
                                                            tabRefs.current[
                                                                activeTab
                                                            ]?.current;
                                                        const dir =
                                                            ref?.getDir();

                                                        if (dir) {
                                                            // const entries = await dir.readDir(".");
                                                            // console.log(entries);
                                                            const bytes =
                                                                await dir.readFile(
                                                                    `/${file.name.split(".").slice(0, -1).join(".")}_m.${file.name.split(".").pop()}`,
                                                                );
                                                            // console.log(bytes);
                                                            const blob =
                                                                new Blob(
                                                                    [bytes],
                                                                    {
                                                                        type: "application/octet-stream",
                                                                    },
                                                                );
                                                            const url =
                                                                URL.createObjectURL(
                                                                    blob,
                                                                );
                                                            const a =
                                                                document.createElement(
                                                                    "a",
                                                                );
                                                            a.href = url;
                                                            a.download = `${file.name.split(".").slice(0, -1).join(".")}_m.${file.name.split(".").pop()}`;
                                                            a.click();
                                                            URL.revokeObjectURL(
                                                                url,
                                                            );
                                                            writer?.write(
                                                                encoder.encode(
                                                                    '?e "\\ec"',
                                                                ),
                                                            );
                                                            writer?.write(
                                                                encoder.encode(
                                                                    "\r",
                                                                ),
                                                            );
                                                            writer?.write(
                                                                encoder.encode(
                                                                    "?e [S] File saved successfully!",
                                                                ),
                                                            );
                                                            writer?.write(
                                                                encoder.encode(
                                                                    "\r",
                                                                ),
                                                            );
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
                                        </li>
                                    )}
                                </ul>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        marginTop: "10px",
                                    }}
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            document
                                                .getElementById("file-upload")
                                                ?.click()
                                        }
                                        disabled={!isFileSelected}
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
                                        ref={fileInputRef}
                                        id="file-upload"
                                        type="file"
                                        multiple
                                        onChange={(event) => {
                                            if (event.target.files) {
                                                handleFileUpload(event.target.files);
                                            }
                                        }}
                                        style={{ display: "none" }}
                                    />
                                </div>
                                <div
                                    style={{
                                        marginTop: "20px",
                                        textAlign: "center",
                                    }}
                                >
                                    <button
                                        onClick={() => setShowShortcuts(true)}
                                        className="ghost"
                                    >
                                        Shortcuts
                                    </button>
                                </div>
                            </div>
                        )}
                        {!sidebarOpen && (
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="icon-btn"
                                style={{
                                    position: "fixed",
                                    left: "10px",
                                    top: "10px",
                                    zIndex: 1000,
                                }}
                            >
                                ☰
                            </button>
                        )}
                        <div
                            style={{
                                flex: 1,
                                minHeight: 0,
                                position: "relative",
                                display: "flex",
                            }}
                        >
                            <div
                                style={{
                                    flex: showCodeEditor && !isMobile ? 1 : 1,
                                    minHeight: 0,
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "column",
                                }}
                            >
                                {tabs.map((id) => {
                                    if (!tabRefs.current[id])
                                        tabRefs.current[id] =
                                            createRef<R2TabHandle>();
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
                                    <div style={{ color: "#ccc", padding: "1rem" }}>
                                        No tabs open
                                    </div>
                                )}
                            </div>
                            {showCodeEditor && !isMobile && (
                                <div
                                    style={{
                                        width: "50%",
                                        minWidth: "400px",
                                        borderLeft: "1px solid #333",
                                        display: "flex",
                                        flexDirection: "column",
                                    }}
                                >
                                    <CodeEditorView
                                        isOpen={true}
                                        onClose={() => setShowCodeEditor(false)}
                                        dir={getActiveDir()}
                                        docked={true}
                                        refreshKey={codeEditorRefreshKey}
                                        onFullscreen={() => {
                                            setCodeEditorFullscreen(true);
                                        }}
                                        onRun={handleRunScript}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {showStringsView && (
                <StringsView
                    strings={stringsData}
                    onClose={() => setShowStringsView(false)}
                    onSeekAddress={handleSeekAddress}
                />
            )}
            {showHexView && (
                <HexView
                    hexData={hexData}
                    onClose={() => setShowHexView(false)}
                    onSeekAddress={handleSeekAddress}
                />
            )}
            {showGraphView && graphData && (
                <CFGView
                    graphData={graphData}
                    onClose={() => setShowGraphView(false)}
                />
            )}
            {(showCodeEditor && isMobile || codeEditorFullscreen) && (
                <CodeEditorView
                    isOpen={showCodeEditor || codeEditorFullscreen}
                    onClose={() => {
                        setShowCodeEditor(false);
                        setCodeEditorFullscreen(false);
                    }}
                    dir={getActiveDir()}
                    refreshKey={codeEditorRefreshKey}
                />
            )}
        </>
    );
}
