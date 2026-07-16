type FileData = {
    name: string;
    data: Uint8Array;
};

class FileStore {
    private file: FileData | null = null;
    private customWasm: Uint8Array | null = null;

    setFile(file: FileData) {
        this.file = file;
    }

    getFile(): FileData | null {
        return this.file;
    }

    setCustomWasm(wasm: Uint8Array) {
        this.customWasm = wasm;
    }

    getCustomWasm(): Uint8Array | null {
        return this.customWasm;
    }

    clear() {
        this.file = null;
        this.customWasm = null;
    }
}

export const fileStore = new FileStore();
