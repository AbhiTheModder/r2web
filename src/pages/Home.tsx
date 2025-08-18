import React, { useState } from "react";
import { fileStore } from "../store/FileStore";
import { useNavigate } from "react-router-dom";

const UploadIcon = () => (
    <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ marginBottom: "1rem", opacity: 0.6 }}
    >
        <path
            d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
            fill="currentColor"
        />
    </svg>
);

export default function Home() {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const navigate = useNavigate();

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            setFile(e.target.files[0]);
        }
    };

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
            navigate("/r2");
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
        <div style={styles.pageContainer}>
            <main style={styles.mainContent}>
                <div style={styles.card}>
                    <h1 style={styles.title}>
                        Radare2 Web
                    </h1>
                    <p style={styles.subtitle}>
                        Upload binary files for reverse engineering analysis
                    </p>

                    <div
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        style={{
                            ...styles.dropZone,
                            border: `2px dashed ${isDragging ? "#007bff" : "#ddd"}`,
                            background: isDragging ? "#f0f8ff" : "#fafafa",
                        }}
                    >
                        <UploadIcon />
                        <p style={styles.dropZoneText}>
                            Drag & drop your file here
                        </p>
                        <p style={styles.orText}>or</p>
                        <label htmlFor="file-upload" style={styles.browseLabel}>
                            browse to upload
                        </label>
                        <input
                            id="file-upload"
                            type="file"
                            onChange={onFileChange}
                            style={styles.hiddenInput}
                            accept=".exe,.dll,.so,.bin,.elf,*"
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
                        disabled={!file || isUploading}
                        onClick={onOpenRadare2}
                        style={{
                            ...styles.button,
                            background: (!file || isUploading) ? "#ccc" : "#007bff",
                            cursor: (!file || isUploading) ? "not-allowed" : "pointer",
                            boxShadow: (!file || isUploading) ? "none" : "0 4px 10px rgba(0, 123, 255, 0.3)",
                        }}
                        onMouseEnter={(e) => {
                            if (file && !isUploading) {
                                e.currentTarget.style.background = "#0056b3";
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (file && !isUploading) {
                                e.currentTarget.style.background = "#007bff";
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
    );
}

const styles = {
    pageContainer: {
        display: "flex",
        flexDirection: "column" as const,
        minHeight: "100vh",
        width: "100%",
        background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    },
    mainContent: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flex: "1",
        padding: "2rem",
    },
    card: {
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(10px)",
        padding: "2rem",
        borderRadius: "20px",
        boxShadow: "0 15px 35px rgba(0, 0, 0, 0.1)",
        textAlign: "center" as const,
        maxWidth: "450px",
        width: "100%",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "center",
        alignItems: "center",
    },
    title: {
        fontSize: "2.5rem",
        color: "#2c3e50",
        marginBottom: "0.5rem",
        fontWeight: "700",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
    },
    subtitle: {
        color: "#666",
        fontSize: "1rem",
        marginBottom: "2rem",
        lineHeight: "1.5",
    },
    dropZone: {
        borderRadius: "15px",
        padding: "3rem 2rem",
        marginBottom: "2rem",
        transition: "all 0.3s ease",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "center",
        alignItems: "center",
        minHeight: "200px",
    },
    dropZoneText: {
        color: "#666",
        marginBottom: "0.5rem",
        fontSize: "1.1rem",
        fontWeight: "500",
    },
    orText: {
        color: "#999",
        marginBottom: "1rem",
        fontSize: "0.9rem",
    },
    browseLabel: {
        color: "#007bff",
        fontWeight: "600",
        cursor: "pointer",
        textDecoration: "underline",
        fontSize: "1rem",
        padding: "0.5rem 1rem",
        borderRadius: "5px",
        transition: "background-color 0.2s ease",
    },
    hiddenInput: {
        display: "none",
    },
    fileInfo: {
        background: "rgba(40, 167, 69, 0.1)",
        border: "1px solid rgba(40, 167, 69, 0.2)",
        borderRadius: "10px",
        padding: "1rem",
        marginBottom: "2rem",
    },
    fileName: {
        color: "#28a745",
        fontWeight: "600",
        marginBottom: "0.5rem",
        fontSize: "1rem",
    },
    fileSize: {
        color: "#666",
        fontSize: "0.9rem",
    },
    button: {
        color: "white",
        padding: "1rem 2rem",
        border: "none",
        borderRadius: "10px",
        fontSize: "1.1rem",
        fontWeight: "600",
        transition: "all 0.3s ease",
        width: "100%",
        minHeight: "54px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
    },
    footer: {
        background: "rgba(44, 62, 80, 0.9)",
        backdropFilter: "blur(10px)",
        color: "#fff",
        textAlign: "center" as const,
        padding: "1.5rem",
        fontSize: "0.9rem",
    },
    footerText: {
        margin: "0",
        lineHeight: "1.5",
    },
    footerLink: {
        color: "#74b9ff",
        textDecoration: "none",
        fontWeight: "600",
        transition: "color 0.2s ease",
    },
};
