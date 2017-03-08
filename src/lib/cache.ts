/**
 * Created by grischa on 7/10/16.
 *
 * Database to remember status of files, specifically, whether files have
 * been processed and can be ignored.
 */
import * as fs from "fs";
import * as path from "path";

const PouchDB = require('pouchdb-node');
PouchDB.plugin(require('pouchdb-upsert-bulk'));

const querystring = require('querystring');

import EDMFile from './file_tracking';
import {settings} from "./settings";
import {TransferQueuePool} from "./transfer_queue";

export class EDMFileCache {
    readonly _file_db: any; // PouchDB.Database<EDMCachedFile>;
    readonly _file_transfer_db: any;
    private changes: any;

    //public static caches = {};

    constructor() {
        //EDMFileCache.caches[source.id] = this;

        const file_db_path = this._getOrCreateDbPath('files');
        this._file_db = new PouchDB(file_db_path);
        this.changes = this._file_db.changes({live: true, include_docs: true})
            .on('change', (change) => {
                // console.log(`PouchDB on change event: ${this.basepath}\n${JSON.stringify(change)}\n`);

                let cachedFile = change.doc as EDMCachedFile;
                this.getFileTransfersForFile(cachedFile).then((transfers) => {
                    if (!change.deleted) {
                        this.queuePendingTransfers(cachedFile, transfers);
                    }
                });

            })
            .on('complete', (info) => {
                console.info(info);
                console.log("stopped listening for changes");
            })
            .on('error', (error) => {
                console.error(`pouchdb changes handling error: ${error}`)
            });

        const file_transfer_db_path = this._getOrCreateDbPath('file_transfers');
        this._file_transfer_db = new PouchDB(file_transfer_db_path);
    }

    private _getOrCreateDbPath(db_name: string, data_path?: string) {
        if (data_path == null) data_path = settings.conf.appSettings.dataDir;
        const db_base = path.normalize(path.join(data_path, 'data'));
        if (!fs.existsSync(db_base)) {
            fs.mkdirSync(db_base, '700');
        }
        return path.join(db_base, db_name);
    }

    addFile(file: EDMFile | EDMCachedFile): Promise<any> {
        if (file instanceof EDMFile) {
            return this._file_db.put(file.getPouchDocument());
        } else {
            return this._file_db.put(file as EDMCachedFile);
        }
    }

    getFile(file: EDMFile | EDMCachedFile): Promise<EDMCachedFile> {
        return this._file_db.get(file._id);
    }

    getFileTransfersForFile(cachedFile: EDMCachedFile): Promise<EDMCachedFileTransfer[]> {
        // This method will be deprecated. The pouchdb-find package should be used instead.
        // return LocalCache.cache._file_transfer_db.query((doc) => {
        //     var emit: any; // workaround to make TypeScript happy
        //     emit(doc.file_local_id);
        // }, {key: cachedFile._id})
        //// .then((result) => {
        ////     return result.rows;
        //// });

        // allDocs method - probably more efficient if the number of simultaneous transfers
        // is small and we periodically cleanup delete completed transfers.
        return LocalCache.cache._file_transfer_db.allDocs({include_docs: true})
            .then((result) => {
                let transfers: EDMCachedFileTransfer[] = [];
                for (let doc of result.rows) {
                    if (doc.doc.file_local_id == cachedFile._id) {
                        transfers.push(doc.doc as EDMCachedFileTransfer);
                    }
                }
                return transfers;
            });
    }

    updateFileTransfers(transfers: EDMCachedFileTransfer[]): Promise<any> {
        return this._file_transfer_db.upsertBulk(transfers);
    }

    queuePendingTransfers(cachedFile: EDMCachedFile, transfers: EDMCachedFileTransfer[]) {
        if (transfers == null) return;

        for (let xfer of transfers) {
            if (xfer.status === 'new') {
                // TODO: How do we ensure jobs that fail to _queue (backpressure or real failure) get requeued later ?
                // TODO: How do we prevent a transfer being queued twice ?
                // TODO: How do we update the local cache with the new file transfers status (just createOrUpdate on
                // the file again to retrieve new transfer statuses ?) ?

                //let queue_unsaturated: boolean = true;
                let xfer_job = TransferQueuePool.createTransferJob(cachedFile, xfer);
                TransferQueuePool.queueTransfer(xfer_job)
                    .then((result) => {
                        // update PouchDB with file transfer status = queued
                        console.log(`file_transfer updated: ${JSON.stringify(result)}`);
                    })
                    .catch((error) => {
                        // we may catch a rejected Promise here if the job cannot be queued at this time
                        // eg, _queue is rejecting jobs due to back-pressure or a network failure notifying the server

                        // TODO: How do we now catch 'new' transfers that didn't get queued here,
                        //       given that they won't be detected now unless the 'change' event fires again
                        //       for that EDMCachedFile record.
                        throw Error(`ERROR: ${error}`);
                    });

                // if (!queue_unsaturated) {
                //     // TODO: If the the _queue is saturated (highWaterMark exceeded), we need to wait
                //     //       until it emits the 'drain' event before attempting to _queue more to respect
                //     //       back pressure.
                //     throw Error(`[Not implemented]: TransferQueues ${xfer.destination_id} is saturated. File transfer ${xfer._id} must be queued later`);
                // }
            }
        }
    }
}

export class CacheProxy {
    private _cache: EDMFileCache;
    public get cache(): EDMFileCache {
        if (this._cache == null) this._cache = new EDMFileCache();
        return this._cache;
    }
}

export const LocalCache = new CacheProxy();
