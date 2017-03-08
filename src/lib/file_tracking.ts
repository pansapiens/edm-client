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

export default class EDMFile {
    readonly _id: string;
    remote_id: string;  // UUID from the server, TODO: use this as a PouchDB secondary index

    private _stats: fs.Stats;
    public get stats() {
        return this._stats;
    }
    public set stats(newStats: fs.Stats) {
        this._stats = newStats;
        this._updateHash();
    }

    _hash: string;
    public get hash(): string {
        return this._hash;
    }

    constructor(readonly source: EDMSource, readonly filepath: string, stats?: fs.Stats) {
        this._id = this._generateID();
        if (stats == null) this.updateStats();
    }

    public static generateID(basepath: string, filepath: string): string {
        return `file://${path.join(basepath, filepath)}`;
    }

    private _generateID(): string {
        return EDMFile.generateID(this.source.basepath, this.filepath);
    }

    private _updateHash() {
        this._hash = this._computeHash();
    }

    private _computeHash(): string {
        return EDMFile.computeHash(this._id, this.stats.size, this.stats.mtime.getTime());
    }

    public static computeHash(id: string, size: number, mtime: number): string {
        const format = 'psm';
        const hash = `${id}-${size}-${mtime}`;
        return `urn:${format}:${hash}`;
    }

    updateStats() {
        this.stats = fs.statSync(path.resolve(this.source.basepath, this.filepath));
    }

    getPouchDocument(): EDMCachedFile {
        return {
            _id: this._id,
            remote_id: this.remote_id,
            source_id: this.source.id,
            mtime: this.stats.mtime.getTime(),
            size: this.stats.size,
            hash: this.hash,
        } as EDMCachedFile;
    }
}
