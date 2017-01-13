/**
 * Created by grischa on 6/10/16.
 *
 * Tracking each file
 *
 *
 * Discover file
 *
 * [x] Gather basic information
 * [x] create hash from path, mtime, size
 * [] Check whether file has been handled (locally, server)
 * -> [x] Local Cache
 * [x] If handled locally ignore
 * [] Check server
 * [] If handled on server, add to local cache and ignore
 * [] If not handled, handle
 * [] If configured, gather custom information
 * [] Register file with server, cache state locally
 * [] Get info from server on what to do with file (or follow some rule in local settings?)
 * [] Do that with file, add to action queue (action and plugin protocol needed, e.g. actions, data, state, progress)
 * [] Update server on progress, cache information
 * [] When file processing/transfer successful, update server and then local cache.
 *
 */

import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

export default class EDMFile {
    // TODO: these properties should be made readonly, or the hash should
    //       automatically update if any of these properties are changed
    _id: string;
    basepath: string;
    filepath: string;
    stats: fs.Stats;
    hash: string;
    status: string;

    /**
     * Statuses available:
     * unknown
     * uploaded
     * uploading
     * interrupted
     * verifying
     * new
     * modified
     */

    constructor(basepath: string, filepath: string, stats?: any) {
        this.basepath = basepath;
        this.filepath = filepath;
        this._id = filepath;
        if (stats == null) {
            this.updateStats();
        }
        else {
            this.stats = stats;
            this._updateHash();
        }
    }

    private _updateHash() {
        this.hash = this._computeHash();
    }

    private _computeHash(): string {
        const format = 'psm';
        const hash = `${this.filepath}-${this.stats.size}-${this.stats.mtime.getTime()}`;
        return `urn:${format}:${hash}`;
    }

    public static computeHash(file: EDMFile): string {
        return file._computeHash();
    }

    updateStats() {
        this.stats = fs.statSync(path.resolve(this.basepath, this.filepath));
        this._updateHash();
    }

    getPouchDocument(): EDMCachedFile {
        return {
            _id: this.filepath,
            mtime: this.stats.mtime.getTime(),
            size: this.stats.size,
            hash: this.hash,
        } as EDMCachedFile;
    }

    getGqlVariables() {
        let variables = _.pick(this.stats, ['size', 'mtime', 'atime', 'ctime', 'birthtime', 'mode']);
        variables['filepath'] = this.filepath;
        return variables;
    }
}
