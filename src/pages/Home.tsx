import React, { useEffect, useState, useRef } from "react";
import { fileStore } from "../store/FileStore";
import { projectStore, type ProjectMeta } from "../store/ProjectStore";
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

const ProjectIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={style}
    >
        <path
            d="M20 6H12L10 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6ZM20 18H4V8H20V18Z"
            fill="currentColor"
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
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [projectFile, setProjectFile] = useState<File | null>(null);
    const [isDraggingProject, setIsDraggingProject] = useState(false);
    const projectInputRef = useRef<HTMLInputElement>(null);
    const [cachedProjects, setCachedProjects] = useState<ProjectMeta[]>([]);
    const [selectedCachedProject, setSelectedCachedProject] = useState<string | null>(null);
    const [loadingProject, setLoadingProject] = useState(false);

    useEffect(() => {
        fileStore.clear();
        loadCachedProjects();
    }, []);

    const loadCachedProjects = async () => {
        try {
            const projects = await projectStore.list();
            setCachedProjects(projects);
        } catch (_e) {
            // IndexedDB may not be available
        }
    };

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            setFile(e.target.files[0]);
        }
    };

    const onProjectFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            const pf = e.target.files[0];
            if (!pf.name.endsWith(".zrp")) return;
            setProjectFile(pf);
            setSelectedCachedProject(null);
            try {
                const data = new Uint8Array(await pf.arrayBuffer());
                await projectStore.save(pf.name, data);
                await loadCachedProjects();
            } catch (_e) {
                // storage error, non-critical
            }
        }
    };

    const onProjectDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingProject(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && droppedFile.name.endsWith(".zrp")) {
            setProjectFile(droppedFile);
            setSelectedCachedProject(null);
            try {
                const data = new Uint8Array(await droppedFile.arrayBuffer());
                await projectStore.save(droppedFile.name, data);
                await loadCachedProjects();
            } catch (_e) {
                // storage error, non-critical
            }
        }
    };

    const onProjectDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingProject(true);
    };

    const onProjectDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDraggingProject(false);
        }
    };

    const selectCachedProject = async (name: string) => {
        setLoadingProject(true);
        try {
            const data = await projectStore.load(name);
            if (data) {
                setProjectFile(new File([data], name));
                setSelectedCachedProject(name);
            }
        } catch (_e) {
            // load error
        } finally {
            setLoadingProject(false);
        }
    };

    const deleteCachedProject = async (name: string) => {
        await projectStore.delete(name);
        await loadCachedProjects();
        if (selectedCachedProject === name) {
            setSelectedCachedProject(null);
            setProjectFile(null);
        }
    };

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
                setR2Versions(prevVersions => [prevVersions[0], ...versions]);
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

            if (projectFile) {
                const projectArrayBuffer = await projectFile.arrayBuffer();
                fileStore.setProjectFile({
                    name: projectFile.name,
                    data: new Uint8Array(projectArrayBuffer),
                });
            } else {
                fileStore.setProjectFile(null);
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

    const formatDate = (timestamp: number) => {
        const d = new Date(timestamp);
        return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
                            <label style={styles.cacheLabel}>
                                <input
                                    type="checkbox"
                                    checked={cacheVersion}
                                    onChange={() => setCacheVersion(!cacheVersion)}
                                    style={styles.cacheCheckbox}
                                />
                                Cache this version
                            </label>
                        </div>

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
                                Drag & drop your binary here
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

                        {file && (
                            <div style={styles.projectSection}>
                                <div style={styles.projectHeader}>
                                    <ProjectIcon style={{ width: "18px", height: "18px", color: "#aaa" }} />
                                    <span style={styles.projectTitle}>Import project (optional)</span>
                                </div>
                                <p style={styles.projectHint}>
                                    Load a .zrp project file to restore analysis, comments, and metadata.
                                </p>
                                <div
                                    onClick={() => projectInputRef.current?.click()}
                                    onDragOver={onProjectDragOver}
                                    onDragLeave={onProjectDragLeave}
                                    onDrop={onProjectDrop}
                                    onMouseEnter={(e) => {
                                        if (!isDraggingProject) {
                                            e.currentTarget.style.borderColor = '#555';
                                            e.currentTarget.style.background = '#1a1a1a';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isDraggingProject) {
                                            e.currentTarget.style.borderColor = '#333';
                                            e.currentTarget.style.background = '#111';
                                        }
                                    }}
                                    style={{
                                        ...styles.projectDropZone,
                                        border: `1px dashed ${isDraggingProject ? '#00aa00' : '#333'}`,
                                        background: isDraggingProject ? '#001100' : '#111',
                                    }}
                                >
                                    <span style={{ color: "#aaa", fontSize: "0.85rem" }}>Drop .zrp here or browse</span>
                                    <input
                                        ref={projectInputRef}
                                        type="file"
                                        accept=".zrp"
                                        onChange={onProjectFileChange}
                                        style={styles.hiddenInput}
                                    />
                                </div>

                                {projectFile && (
                                    <div style={styles.selectedProjectInfo}>
                                        <span style={{ color: "#00aa00", fontSize: "0.85rem", wordBreak: "break-all" }}>
                                            {projectFile.name}
                                        </span>
                                        <span style={{ color: "#888", fontSize: "0.8rem", marginLeft: "8px" }}>
                                            {formatFileSize(projectFile.size)}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setProjectFile(null);
                                                setSelectedCachedProject(null);
                                            }}
                                            style={{
                                                marginLeft: "auto",
                                                background: "none",
                                                border: "none",
                                                color: "#aa3333",
                                                cursor: "pointer",
                                                fontSize: "0.85rem",
                                                padding: "0 4px",
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                )}

                                {cachedProjects.length > 0 && (
                                    <div style={styles.cachedProjectsContainer}>
                                        <div style={styles.cachedProjectsHeader}>Saved projects</div>
                                        {cachedProjects.map((p) => (
                                            <div
                                                key={p.name}
                                                onClick={() => !loadingProject && selectCachedProject(p.name)}
                                                style={{
                                                    ...styles.cachedProjectItem,
                                                    background: selectedCachedProject === p.name ? "#002200" : "#151515",
                                                    borderColor: selectedCachedProject === p.name ? "#00aa00" : "#2a2a2a",
                                                    cursor: loadingProject ? "wait" : "pointer",
                                                }}
                                            >
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ color: "#ccc", fontSize: "0.85rem", wordBreak: "break-all" }}>
                                                        {p.name}
                                                    </div>
                                                    <div style={{ color: "#666", fontSize: "0.75rem" }}>
                                                        {formatFileSize(p.size)} · {formatDate(p.savedAt)}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deleteCachedProject(p.name);
                                                    }}
                                                    style={{
                                                        background: "none",
                                                        border: "none",
                                                        color: "#aa3333",
                                                        cursor: "pointer",
                                                        fontSize: "0.8rem",
                                                        padding: "2px 6px",
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            disabled={!file || isUploading}
                            onClick={onOpenRadare2}
                            style={{
                                ...styles.button,
                                background: (!file || isUploading) ? '#333' : '#222',
                                borderColor: (!file || isUploading) ? '#333' : '#444',
                                cursor: (!file || isUploading) ? "not-allowed" : "pointer",
                                color: (!file || isUploading) ? '#666' : '#e0e0e0',
                            }}
                            onMouseEnter={(e) => {
                                if (file && !isUploading) {
                                    e.currentTarget.style.background = '#333';
                                    e.currentTarget.style.borderColor = '#555';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (file && !isUploading) {
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
    projectSection: {
        width: "100%",
        marginBottom: "1.5rem",
    },
    projectHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "6px",
    },
    projectTitle: {
        color: "#ccc",
        fontSize: "0.95rem",
        fontWeight: "500" as const,
    },
    projectHint: {
        color: "#777",
        fontSize: "0.8rem",
        marginBottom: "10px",
        lineHeight: "1.3",
    },
    projectDropZone: {
        borderRadius: "0",
        padding: "12px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        transition: "border-color 0.3s ease, background 0.3s ease",
        minHeight: "40px",
        boxSizing: "border-box" as const,
    },
    selectedProjectInfo: {
        display: "flex",
        alignItems: "center",
        background: "#001100",
        border: "1px solid #004400",
        padding: "8px 12px",
        marginTop: "8px",
    },
    cachedProjectsContainer: {
        marginTop: "10px",
    },
    cachedProjectsHeader: {
        color: "#888",
        fontSize: "0.8rem",
        marginBottom: "6px",
        textTransform: "uppercase" as const,
        letterSpacing: "0.5px",
    },
    cachedProjectItem: {
        display: "flex",
        alignItems: "center",
        padding: "8px 10px",
        border: "1px solid #2a2a2a",
        marginBottom: "4px",
        transition: "background 0.2s ease",
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