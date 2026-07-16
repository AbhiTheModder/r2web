import React, { useEffect, useState, useRef } from "react";
import { fileStore } from "../store/FileStore";
import { useNavigate } from "react-router-dom";

const UploadIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ marginBottom: "1rem", ...style }}
    >
        <path
            d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

export default function Home() {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState("6.1.8");
    const [cacheVersion, setCacheVersion] = useState(false);
    const [loadingVersions, setLoadingVersions] = useState(true);
    const [customWasmFile, setCustomWasmFile] = useState<File | null>(null);
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const wasmInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fileStore.clear();
    }, []);

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            setFile(e.target.files[0]);
        }
    };

    const onWasmFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            setCustomWasmFile(e.target.files[0]);
        }
    };

    const isCustom = selectedVersion === "custom";

    const [r2Versions, setR2Versions] = useState([
        { value: "6.1.8", label: "r2 6.1.8" },
    ]);

    useEffect(() => {
        const fetchR2Versions = async () => {
            try {
                setLoadingVersions(true);
                const response = await fetch('https://api.github.com/repos/radareorg/radare2/releases');
                const data = await response.json();
                const versions = data
                    .map((release: { tag_name: string; }) => ({
                        value: release.tag_name,
                        label: `r2 ${release.tag_name}`,
                    }))
                    .filter((version: { value: string; }) => version.value !== "6.1.8" && /^\d+\.\d+\.\d+$/.test(version.value))
                    .sort((a: { value: string; }, b: { value: string; }) => {
                        const va = a.value.split('.').map(Number);
                        const vb = b.value.split('.').map(Number);
                        for (let i = 0; i < 3; i++) {
                            if (va[i] !== vb[i]) return vb[i] - va[i];
                        }
                        return 0;
                    })
                    .slice(0, 21);
                setR2Versions(prevVersions => [prevVersions[0], ...versions, { value: "custom", label: "Custom WASM build..." }]);
            } catch (error) {
                console.error('Error fetching r2 versions:', error);
            } finally {
                setLoadingVersions(false);
            }
        };

        fetchR2Versions();
    }, []);

    const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length) {
            setFile(e.dataTransfer.files[0]);
        }
    };

    const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
        }
    };

    const onOpenRadare2 = async () => {
        if (!file) return;

        setIsUploading(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            fileStore.setFile({
                name: file.name,
                data: new Uint8Array(arrayBuffer),
            });
            if (isCustom && customWasmFile) {
                const wasmBuffer = await customWasmFile.arrayBuffer();
                fileStore.setCustomWasm(new Uint8Array(wasmBuffer));
            }
            navigate(`/r2?version=${selectedVersion}&cache=${cacheVersion}`);
        } catch (error) {
            console.error("Error processing file:", error);
        } finally {
            setIsUploading(false);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    return (
        <>
            <style>{`
                html, body, #root { height: 100%; font-family: 'Courier New', monospace; }
                html, body { margin: 0; padding: 0; overscroll-behavior: none; background: #0a0a0a; color: #e0e0e0; }
                /* Global scroll container configured in main.tsx (.app-root) */
                select, input[type="checkbox"] { font-family: inherit; }
                option { font-family: inherit; }
            `}</style>
            <div style={styles.pageContainer}>
                <main style={styles.mainContent}>
                    <div style={styles.card}>
                        <h1 style={styles.title}>
                            Radare2 Web
                        </h1>
                        <p style={styles.subtitle}>
                            Inspect, modify, and explore binaries directly in your browser.
                        </p>

                        <div style={styles.versionSelector}>
                            <label htmlFor="version-select" style={styles.versionLabel}>
                                Select Radare2 Version:
                            </label>
                            <select
                                id="version-select"
                                value={selectedVersion}
                                onChange={(e) => setSelectedVersion(e.target.value)}
                                disabled={loadingVersions}
                                style={{
                                    ...styles.versionDropdown,
                                    opacity: loadingVersions ? 0.5 : 1,
                                    cursor: loadingVersions ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {loadingVersions ? (
                                    <option>Loading versions...</option>
                                ) : (
                                    r2Versions.map((version) => (
                                        <option key={version.value} value={version.value}>
                                            {version.label}
                                        </option>
                                    ))
                                )}
                            </select>
                            {!isCustom && (
                                <label style={styles.cacheLabel}>
                                    <input
                                        type="checkbox"
                                        checked={cacheVersion}
                                        onChange={() => setCacheVersion(!cacheVersion)}
                                        style={styles.cacheCheckbox}
                                    />
                                    Cache this version
                                </label>
                            )}
                        </div>

                        {isCustom && (
                            <div
                                onClick={() => wasmInputRef.current?.click()}
                                style={{
                                    ...styles.dropZone,
                                    border: '1px dashed #444',
                                    background: customWasmFile ? '#001100' : 'transparent',
                                    cursor: 'pointer',
                                    minHeight: '100px',
                                    padding: '1rem',
                                    marginBottom: '0.75rem',
                                }}
                            >
                                <p style={{ ...styles.dropZoneText, fontSize: '0.85rem' }}>
                                    {customWasmFile ? customWasmFile.name : 'Upload custom radare2.wasm'}
                                </p>
                                <p style={{ ...styles.orText, fontSize: '0.75rem' }}>
                                    {customWasmFile ? `${(customWasmFile.size / 1024 / 1024).toFixed(1)} MB` : 'or click to browse'}
                                </p>
                                <input
                                    ref={wasmInputRef}
                                    type="file"
                                    accept=".wasm"
                                    onChange={onWasmFileChange}
                                    style={styles.hiddenInput}
                                />
                            </div>
                        )}

                        <div
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={onDragOver}
                            onDragLeave={onDragLeave}
                            onDrop={onDrop}
                            onMouseEnter={(e) => {
                                if (!isDragging) {
                                    e.currentTarget.style.borderColor = '#666';
                                    e.currentTarget.style.background = '#1a1a1a';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isDragging) {
                                    e.currentTarget.style.borderColor = '#444';
                                    e.currentTarget.style.background = 'transparent';
                                }
                            }}
                            style={{
                                ...styles.dropZone,
                                border: `1px ${isDragging ? '#00aa00' : 'dashed #444'}`,
                                background: isDragging ? '#001100' : 'transparent',
                                cursor: 'pointer',
                            }}
                        >
                            <UploadIcon style={{ color: isDragging ? '#00aa00' : '#666' }} />
                            <p style={styles.dropZoneText}>
                                Drag & drop your file here
                            </p>
                            <p style={styles.orText}>or</p>
                            <p style={styles.browseLabel}>
                                browse to upload
                            </p>
                            <input
                                ref={fileInputRef}
                                id="file-upload"
                                type="file"
                                onChange={onFileChange}
                                style={styles.hiddenInput}
                            />
                        </div>

                        {file && (
                            <div style={styles.fileInfo}>
                                <div style={styles.fileName}>
                                    {file.name}
                                </div>
                                <div style={styles.fileSize}>
                                    Size: {formatFileSize(file.size)}
                                </div>
                            </div>
                        )}

                        <button
                            disabled={!file || isUploading || (isCustom && !customWasmFile)}
                            onClick={onOpenRadare2}
                            style={{
                                ...styles.button,
                                background: (!file || isUploading || (isCustom && !customWasmFile)) ? '#333' : '#222',
                                borderColor: (!file || isUploading || (isCustom && !customWasmFile)) ? '#333' : '#444',
                                cursor: (!file || isUploading || (isCustom && !customWasmFile)) ? "not-allowed" : "pointer",
                                color: (!file || isUploading || (isCustom && !customWasmFile)) ? '#666' : '#e0e0e0',
                            }}
                            onMouseEnter={(e) => {
                                if (file && !isUploading && !(isCustom && !customWasmFile)) {
                                    e.currentTarget.style.background = '#333';
                                    e.currentTarget.style.borderColor = '#555';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (file && !isUploading && !(isCustom && !customWasmFile)) {
                                    e.currentTarget.style.background = '#222';
                                    e.currentTarget.style.borderColor = '#444';
                                }
                            }}
                        >
                            {isUploading ? "Processing..." : "Open with Radare2"}
                        </button>
                    </div>
                </main>

                <footer style={styles.footer}>
                    <p style={styles.footerText}>
                        Built with ⌨️, 🖱️ & ❤️ by{" "}
                        <a
                            href="https://github.com/AbhiTheModder"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={styles.footerLink}
                        >
                            Abhi
                        </a>
                    </p>
                </footer>
            </div>
        </>
    );
}

const styles = {
    pageContainer: {
        display: "flex",
        flexDirection: "column" as const,
        minHeight: "100vh",
        width: "100%",
        background: "#0a0a0a",
    },
    mainContent: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flex: "1",
        padding: "2rem",
    },
    card: {
        background: "#1a1a1a",
        border: "1px solid #333",
        padding: "2rem",
        textAlign: "center" as const,
        maxWidth: "500px",
        width: "100%",
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "center",
        alignItems: "center",
    },
    title: {
        fontSize: "2rem",
        color: "#e0e0e0",
        marginBottom: "0.5rem",
        fontWeight: "bold" as const,
        letterSpacing: "0.5px",
    },
    subtitle: {
        color: "#aaa",
        fontSize: "0.9rem",
        marginBottom: "1.5rem",
        lineHeight: "1.4",
    },
    versionSelector: {
        marginBottom: "1.5rem",
        width: "100%",
    },
    versionLabel: {
        display: "block",
        marginBottom: "0.5rem",
        color: "#aaa",
        fontSize: "0.85rem",
        fontWeight: "500" as const,
    },
    versionDropdown: {
        width: "100%",
        padding: "0.75rem",
        border: "1px solid #444",
        backgroundColor: "#222",
        color: "#e0e0e0",
        fontSize: "0.9rem",
        outline: "none",
        transition: "border-color 0.2s ease",
        cursor: "pointer",
    },
    cacheLabel: {
        display: "flex",
        alignItems: "center",
        marginTop: "0.75rem",
        color: "#aaa",
        fontSize: "0.85rem",
    },
    cacheCheckbox: {
        marginRight: "0.5rem",
        accentColor: "#00aa00",
    },
    dropZone: {
        borderRadius: "0",
        border: "1px dashed #444",
        padding: "2rem 1.5rem",
        marginBottom: "1.5rem",
        transition: "border-color 0.3s ease, background 0.3s ease",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "center",
        alignItems: "center",
        minHeight: "180px",
        boxSizing: "border-box" as const,
    },
    dropZoneText: {
        color: "#aaa",
        marginBottom: "0.5rem",
        fontSize: "1rem",
        fontWeight: "500" as const,
    },
    orText: {
        color: "#666",
        marginBottom: "0.75rem",
        fontSize: "0.85rem",
    },
    browseLabel: {
        color: "#00aa00",
        fontWeight: "500" as const,
        cursor: "pointer",
        textDecoration: "underline",
        fontSize: "0.95rem",
        transition: "color 0.2s ease",
        padding: "0.25rem 0.5rem",
    },
    hiddenInput: {
        display: "none",
    },
    fileInfo: {
        background: "#001100",
        border: "1px solid #004400",
        borderRadius: "0",
        padding: "1rem",
        marginBottom: "1.5rem",
        width: "100%",
        boxSizing: "border-box" as const,
    },
    fileName: {
        color: "#00aa00",
        fontWeight: "500" as const,
        fontSize: "0.95rem",
        wordBreak: "break-all" as const,
    },
    fileSize: {
        color: "#aaa",
        fontSize: "0.85rem",
        marginTop: "0.25rem",
    },
    button: {
        color: "#e0e0e0",
        padding: "0.875rem 1.5rem",
        border: "1px solid #444",
        borderRadius: "0",
        fontSize: "0.95rem",
        fontWeight: "500" as const,
        transition: "all 0.2s ease",
        width: "100%",
        background: "#222",
        cursor: "pointer",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        boxSizing: "border-box" as const,
    },
    footer: {
        background: "#111",
        borderTop: "1px solid #333",
        color: "#aaa",
        textAlign: "center" as const,
        padding: "1rem",
        fontSize: "0.8rem",
        marginTop: "auto",
    },
    footerText: {
        margin: "0",
        lineHeight: "1.4",
    },
    footerLink: {
        color: "#00aa00",
        textDecoration: "none",
        fontWeight: "500" as const,
        transition: "color 0.2s ease",
    },
} as const;
