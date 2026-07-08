type FileData = {
    name: string;
    data: Uint8Array;
};

class FileStore {
    private file: FileData | null = null;
    private projectFile: FileData | null = null;

    setFile(file: FileData) {
        this.file = file;
    }

    getFile(): FileData | null {
        return this.file;
    }

    setProjectFile(pf: FileData | null) {
        this.projectFile = pf;
    }

    getProjectFile(): FileData | null {
        return this.projectFile;
    }

    clear() {
        this.file = null;
        this.projectFile = null;
    }
}

export const fileStore = new FileStore();