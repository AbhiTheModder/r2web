export type ProjectMeta = {
    name: string;
    size: number;
    savedAt: number;
};

const DB_NAME = "r2web-projects";
const STORE_NAME = "projects";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

class ProjectStore {
    async save(name: string, data: Uint8Array): Promise<void> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put({ data, size: data.byteLength, savedAt: Date.now() }, name);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async list(): Promise<ProjectMeta[]> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        const keysRequest = store.getAllKeys();
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                const entries = request.result as Array<{ data: Uint8Array; size: number; savedAt: number }>;
                const keys = keysRequest.result as string[];
                const metas: ProjectMeta[] = keys.map((key, i) => ({
                    name: key,
                    size: entries[i]?.size ?? 0,
                    savedAt: entries[i]?.savedAt ?? 0,
                }));
                metas.sort((a, b) => b.savedAt - a.savedAt);
                resolve(metas);
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async load(name: string): Promise<Uint8Array | null> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(name);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                if (request.result) {
                    resolve(request.result.data as Uint8Array);
                } else {
                    resolve(null);
                }
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async delete(name: string): Promise<void> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(name);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clear(): Promise<void> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

export const projectStore = new ProjectStore();