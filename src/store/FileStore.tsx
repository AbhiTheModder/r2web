type FileData = {
    name: string;
    data: Uint8Array;
};

class FileStore {
    private file: FileData | null = null;

    setFile(file: FileData) {
        this.file = file;
    }

    getFile(): FileData | null {
        return this.file;
    }

    clear() {
        this.file = null;
    }
}

export const fileStore = new FileStore();
