import fs from "fs";
import path from "path";

import Folder from "./folder/Folder.class.mjs";
import File from "./file/File.class.mjs";

class ServerFolder extends Folder {
    constructor({
        parentFolderPath,
        folderPath,
        name
    }) {
        const props = {
            parentFolderPath,
            folderPath,
            name
        };
        super(props);
    }

        
    /**
     * Childrens are the sub directories, and / or files depending on the following parameters :
     * @param {boolean} directories
     * @param {boolean} files
     * @param {boolean} symbolicLinksAndOthers if all parameters are `true`, this will display all existant direct files whatever [type](https://nodejs.org/api/fs.html#class-fsstats) it is.
     * @returns {Array<string>} An array with the name of all the directories and / or files inside the directory
     */
    getChildren(directories, files, symbolicLinksAndOthers = false) {
        if (!this.exists()) {
            const errorMessage = `Folder ${this.getFullPath()} do not exist`;
            throw new Error(errorMessage);
        }
        
        // We get the content of the directory using it's path.
        let filesInDir = fs.readdirSync(this.getFullPath());
        if (directories && files && symbolicLinksAndOthers) {
            // If no all green, then we return all results as it.
            return filesInDir;
        } else {
            // Otherwise, we filter the directory's children list to get directories and / or files.
            return filesInDir.filter(
                file => {
                    var fileStats = fs.lstatSync(
                        this.getFullPath() + "/" + file
                    );
                    return (
                        directories && fileStats.isDirectory()
                    ||
                        files && fileStats.isFile()
                    );
                }
            );
        }
    }

    /**
     * @returns {Array<string>} A name list of all directories which are direct children of the current one (`this instanceof ServerFolder` haha).
     */
    getSubFolders() {
        return this.getChildren(true, false);
    }

    /**
     * Recursively finds all the (relative) files paths inside this folder's children hierarchy.
     * @param {object} options
     * @param {RegExp} options.regex The regex expresion used to filter by file name
     * @param {boolean|string} options.asObjectType set to "client" or "server" if you want File or ServerFile objects
     * @param {boolean} options.addDirectoryPath if true, the function will return absolute paths.
     * @returns {Array<string>} Paths list of all subfiles.
     */
    getAllFiles(
        {
            regex,
            asObjectType,
            addDirectoryPath,
        } = {
            regex: false,
            asObjectType: false,
            addDirectoryPath: false
        }
    ) {
        let result = this.getFiles({ regex, asObjectType });
        let directories = this.getSubFolders();
        let currentPath = "";
        directories.forEach(
            (directory) => {
                currentPath += directory + "/";
                let newDirectory = new ServerFolder({
                    parentFolderPath: this.getFullPath() + "/" + directory
                });

                // Recursively gets all the sub files.
                let filesInNewDirectory = newDirectory.getAllFiles({
                    regex,
                    asObjectType,
                })
                
                // Add the current directory path to the file path
                if (!asObjectType) { 
                    filesInNewDirectory = filesInNewDirectory.map(
                        fileName => (
                            (addDirectoryPath ? this.getFullPath() : "") +
                            currentPath + fileName
                        )
                    );
                }

                // And add them to the result list.
                result = result.concat( filesInNewDirectory );
                currentPath = currentPath.replace(directory + "/", "");
            }
        );

        return result;
    }

    
    /**
     * Returns files which are direct children of the current folder.
     * @param {RegExp} regex used to filter the list
     * @param {boolean} asObject it true, return will be of type `Array<File>`
     * @returns {Array<string> | Array<File> | Array<ServerFile>} An array with the name of all the `File`s inside the directory
     */
    getFiles(
        {
            regex,
            asObjectType,
        } = { // default value if nothing provided
            regex: false,
            asObjectType: false
        }
    ) {
        let files = this.getChildren(false, true);

        // Filtering the files names if regex parameter is existant
        if(regex) {
            files = files.filter(
                f => f.match(regex)
            );
        }

        let objectType;
        if (asObjectType) {
            // any values such as `"client"` or `true` are for default mode
            objectType = File;

            if (asObjectType === "server") {
                objectType = ServerFile;
            }

            return files.map(
                (fileName) => new objectType({
                    folderPath: this.getFullPath(),
                    name: fileName,
                })
            );
        } else {
            return files;
        }
    }

    /**
     * @param {RegExp} regex pattern to search in the folder's files content
     * @returns {File} The first file which content's match the regex
     */
    getFileWithContent(regex) {
        return this.getAllFilesWithContent(regex, true);
    }

    /**
     * @param {RegExp} regex pattern to search in the folder's files content
     * @param {boolean} returnsFirstOnly if true, returns only the first one.
     * @returns All files which match regex pattern content
     */
    getAllFilesWithContent(regex = false, returnsFirstOnly = false) {
        const folderFiles = this.getAllFiles({ asObjectType: "server" });
        
        if(regex) {
            let foundFiles = [];
            for (let index = 0; index < folderFiles.length; index++) {
                const file = folderFiles[index];
                
                const fileStringContent = file.getContent().toString();
    
                if (fileStringContent.match(regex)) {
                    if (returnsFirstOnly) {
                        return file;
                    }
                    foundFiles.push(file);
                }
            }
            return foundFiles;
        }

        return folderFiles;
    }

    /** @returns {boolean} */
    exists() {
        const exists = fs.existsSync(
            this.getFullPath()
        );
        if(!exists) {
            return false;
        } else {
            return fs.lstatSync(this.getFullPath()).isDirectory();
        }
    }

    /** 
     * @returns a cumulated object build from node's `fs.Stats`
     * Like size
    */
    getStats(folderPath) {
        if(!folderPath) {
            folderPath = this.getFullPath();
        }
        return new Promise((resolve, reject) => {
            
            fs.readdir(folderPath, (err, files) => {
                if (err) {
                    return reject(err);
                }
    
                let totalSize = 0;
                let oldestDate = new Date(Date.now());
                let newestDate = new Date(0); // Epoch start: Jan 1, 1970
                let pending = files.length;
    
                if (pending === 0) {
                    return resolve({ size_in_bytes: 0, oldest_modification_date: null, last_modification_date: null });
                }
    
                files.forEach((file) => {
                    const filePath = path.join(folderPath, file);
    
                    fs.lstat(
                        filePath, (err, lstats) => {
                            if (err) {
                                return reject(err);
                            }

                            if (lstats.isSymbolicLink()) {
                                // For symbolic links, use the link's own size and dates without following it
                                totalSize += lstats.size;
                                oldestDate = lstats.mtime < oldestDate ? lstats.mtime : oldestDate;
                                newestDate = lstats.mtime > newestDate ? lstats.mtime : newestDate;

                                if (--pending === 0) {
                                    resolve({ size_in_bytes: totalSize, oldest_modification_date: oldestDate, last_modification_date: newestDate });
                                }
                            } else if (lstats.isDirectory()) {
                                // Recurse into subdirectory
                                this.getStats(filePath)
                                    .then((subDirDetails) => {
                                        totalSize += subDirDetails.size_in_bytes;
                                        oldestDate = subDirDetails.oldest_modification_date < oldestDate || new Date() ? subDirDetails.oldest_modification_date : oldestDate;
                                        newestDate = subDirDetails.last_modification_date > newestDate ? subDirDetails.last_modification_date : newestDate;
        
                                        if (--pending === 0) {
                                            resolve({ size_in_bytes: totalSize, oldest_modification_date: oldestDate, last_modification_date: newestDate });
                                        }
                                    })
                                    .catch(reject);
                            } else {
                                // Update total size and modification dates
                                
                                totalSize += lstats.size;
                                oldestDate = lstats.mtime < oldestDate ? lstats.mtime : oldestDate;
                                newestDate = lstats.mtime > newestDate ? lstats.mtime : newestDate;
        
                                if (--pending === 0) {
                                    resolve({ size_in_bytes: totalSize, oldest_modification_date: oldestDate, last_modification_date: newestDate });
                                }
                            }
                        });
                    }
                );
            });
        })
    }

    /**
     * Create the folder if it does not exists already and returns it.
     * @returns {ServerFolder} this, allowing method chaining as `.create().copyTo("../otherFolder")` using [fluent interface](https://en.wikipedia.org/wiki/Fluent_interface)
     */
    create() {
        const folderDoNotExist = !this.exists();
        if (folderDoNotExist) {
            fs.mkdirSync(
                this.getFullPath(),
                { recursive: true }
            );
        }

        return this;
    }

    /**
     * Create the folder if it does not exists already and returns it.
     * @returns {ServerFolder} this, allowing method chaining as `.create().copyTo("../otherFolder")` using [fluent interface](https://en.wikipedia.org/wiki/Fluent_interface)
    */
    save() {
        this.create();
    }

    /**
     * If file exists, rename it on disk.
     * @param {string} newName 
     * @returns {ServerFolder} this
     */
    rename(newName) {
        if(this.exists()) {
            fs.renameSync(this.getFullPath(), this.parentFolderPath + "/" + newName);
        } else {
            console.error(`Cannot rename folder on disk, you may use the create method first, because this does not exists yet : \n%o\n`, this);
        }

        this.name = newName;
        return this;
    }

    /** Content data is still present when we delete file on disk, it allows `CTRL + Z` */
    delete() {
        if(this.exists()) {
            const folderPath = this.getFullPath();
            fs.rmSync(
                folderPath,
                {
                    recursive: true,
                    force: true
                },
                () => {}
            );
        } else {
            console.error("Folder does not exists :( - " + this.getFullPath());
        }

        return this;
    }

    /** Delete all subfiles and subfolders */
    emptyContent() {
        return this.delete().create();
    }
    
    /**
     * Move the folder and it's content to the target path
     * @param {string} targetPath where do we want to move it ?
     * @returns {ServerFolder} the new folder object
     */
    moveTo(targetPath) {
        targetPath = path.resolve(this.parentFolderPath, targetPath);
        if (new ServerFolder({folderPath: targetPath}).exists()) {
            console.error("Target destination already exists !");
        }
        else if(this.exists()) {
            fs.renameSync(this.getFullPath(), targetPath);
        }
        const parentPath = targetPath.split(path.sep);
        this.name = parentPath.pop();
        this.parentFolderPath = parentPath.join("/");

        return this;
    }

    /**
     * Copy the folder and it's content to the target path
     * @param {string} targetPath where do we want to move it ?
     * @returns {ServerFolder} the new folder object
     */
    copyTo(targetPath) {
        const newPath = path.resolve(this.parentFolderPath, targetPath)
        fs.cpSync(
            this.getFullPath(),
            newPath, {
                recursive: true,
                force: true
            }
        );
        
        return new ServerFolder({
            folderPath: newPath
        });
    }
}

class ServerFile extends File {
    constructor({
        folderPath,
        name,
        extension = "",
        filePath,
        content = "",
        onChange,
        onChangeParams
    }) {
        const props = {
            folderPath,
            name,
            extension,
            filePath,
            content,
        };

        super(props);

        this.parentFolder = new Folder({
            folderPath: this.folderPath
        });

        this.stats = {}
        this.size_in_bytes = 0;
        this.lastModifiedDate = null;
        this.creationDate = null;

        if(this.exists()) {
            this.stats = this.getStats();
            this.size_in_bytes = this.stats.size;
            this.lastModifiedDate = this.stats.mtime;
            this.creationDate = this.stats.birthtime;
        }
        
        if(onChange && typeof onChange === "function") {
            onChange(this, onChangeParams);
        }
    }

    /** @returns {boolean} */
    exists() {
        try {
            return fs.existsSync(this.getFullPath());
        } catch (error) {
            return false;
        }
    }

    /**
     * @returns {ServerFile} File content on disk
     */
    read() {
        if (this.exists()) {
            if(this.size_in_bytes < 2147483648) { // 2GB
                this.setContent(
                    fs.readFileSync(
                        this.getFullPath()
                    )
                );
            } else {
                this.setContent(
                    fs.createReadStream( this.getFullPath() )
                );
            }
        } else {
            console.error( "The " + this.extension +
                " file named " + this.name + " has not been found at path " + this.getFullPath()
            );
        }
        return this;
    }

    /**
     * @returns {Buffer|fs.ReadStream} The file content as a Buffer or a ReadStream if the file is too big.
     */
    getContent() {
        return this.read().content;
    }

    /**
     * Write file on disk using the object data.
     * @returns {ServerFile} this
     */
    create() {
        return this.save();
    }

    /**
     * Write file on disk using the object data.
     * @returns {ServerFile} this
     */
    save() {
        const filePath = this.getFullPath();

        new ServerFolder(this.parentFolder).create();
       
        fs.writeFileSync(
            filePath,
            this.content ?? "",
            function(err) {
                /* istanbul ignore if */
                if(err) {
                    console.error("Couldn't save the file %s : %o", filePath, err);
                }
            }
        );

        this.getStats();
        return this;
    }

    /**
     * @param {string} newName
     * @returns {ServerFile} the renamed file
     */
    rename(newName) {
        if(this.exists()) {
            fs.renameSync(this.getFullPath(), this.folderPath + "/" + newName);
        } else {
            console.error(`Cannot rename file on disk, you may use the create method first, because this does not exists yet : \n%o\n`, this);
        }

        this.name = newName;
        return this;
    }

    /**
     * @returns {ServerFile} the file "cache" that has been deleted on disk.
     */
    delete() {
        if(this.exists()) {
            const filePath = this.getFullPath();
            fs.unlinkSync(filePath);
            this.stats = {}
            this.size_in_bytes = 0;
            this.lastModifiedDate = null;
            this.creationDate = null;
        } else {
            console.error(`Cannot delete file, you may use the create method first, because this does not exists yet : \n%o\n`, this);
        }
        return this;
    }

    /**
     * @returns {fs.Stats}
     */
    getStats() {
        this.stats = fs.statSync(this.getFullPath());
        this.size_in_bytes = this.stats.size;
        this.lastModifiedDate = this.stats.mtime;
        this.creationDate = this.stats.birthtime;
        return this.stats;
    }

    /**
     * @param {string} relativeFolderPath 
     * @returns {ServerFile} this moved file.
     */
    moveTo(relativeFolderPath) {
        const newFolderPath = path.resolve(this.folderPath, relativeFolderPath);
        new ServerFolder({ folderPath: newFolderPath }).create();
        fs.renameSync(this.getFullPath(), newFolderPath + "/" + this.name);
        this.folderPath = newFolderPath;
        return this;
    }

    /**
     * @param {string} relativeFolderPath 
     * @returns {ServerFile} the copied file.
     */
    copyTo(relativeFolderPath) {
        const newPath = path.resolve(this.folderPath, relativeFolderPath) + "/" + (
            this.name + (
                this.extension ? 
                    ("." + this.extension)
                :
                    ""
            )
        ); 
        fs.cpSync(
            this.getFullPath(),
            newPath, {
                recursive: true,
                force: true
            }
        );
        
        return new ServerFile({
            filePath: newPath
        });
    }

    searchAndReplace(regex, replaceValue) {
        this.content.replaceAll(regex, replaceValue);
    }

    /**
     * @param {string} targetPath 
     * @returns {ServerFile} the saved file.
     */
    saveAs(targetPath) {
        const newPath = path.resolve(this.folderPath, targetPath);
        return new ServerFile({ ...this, filePath: newPath }).create();
    }
}

export {
    ServerFile,
    ServerFolder
};