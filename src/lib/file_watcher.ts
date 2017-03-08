import * as path from 'path';
import * as _ from "lodash";
const fs = require('fs-extra');

import {ApolloQueryResult} from "apollo-client";

import * as through2 from 'through2';
import EDMFile from "./file_tracking";
import {EDMFileCache} from "./cache";
import {LocalCache} from "./cache";
import {EDMQueries} from "./queries";


export class EDMFileWatcher {
    cache: EDMFileCache;
    filters: any = [];
    lastWalkItems: any;

    constructor(readonly source: EDMSource, exclude?: any) {
        this.cache = LocalCache.cache; // new EDMFileCache(this.source);
        if (exclude != null) {
            const excluder = new RegExp(exclude);
            let exclude_filter = (path) => {
                return excluder.test(path);
            };
            this.filters.push(exclude_filter);
        }
    }

    walk(job?: any) {
        // using https://github.com/jprichardson/node-klaw
        const walker = fs.walk(this.source.basepath);
        const items = [];
        for (let filter of this.filters) {
            walker.pipe(through2.obj((item, enc, next) => {
                filter(item);
                next();
            }));
        }
        walker.on('readable', () => {
            let item = walker.read();
            this.handleFile(item);
            items.push(item);
        })
        .on('end', () => {
            this.lastWalkItems = items;
            this.endWalk();
        })
        .on('error', (error) => this.handleError(error, job));
    }

    handleFile(file) {
        if (file == null) {
            console.log('file is null');
            return;
        }
        if (file.path === this.source.basepath) {
            console.log("handleFile: skipping handling basepath '.' file")
            return;
        }

        // console.log(file);
        const relpath = path.relative(this.source.basepath, file.path);
        let edmFile = new EDMFile(this.source, relpath, file.stats);
        this.cache.getFile(edmFile).then((cached) => {

            // compare on-disk to local db
            if (this.fileHasChanged(edmFile, cached)) {
                this.registerAndCache(edmFile, cached)
                    // .then((backendResponse) => {
                    //     console.log(`${JSON.stringify(backendResponse)}`);
                    //     this.cache.queuePendingTransfers(cached);
                    // })
                    .catch((error) => {
                        console.error(`Failed to register and cache: ${JSON.stringify(edmFile)} - ${error}`);
                    })
            }
            // console.log(`${cached._id} is in cache (transfers: ${JSON.stringify(cached.transfers)})`);
            console.log(`${cached._id} is in cache.`);
        }).catch((error) => {
            if (error.name === "not_found") {
                // new file (unknown to client, may be known to server if local cache was cleared)
                this.registerAndCache(edmFile).catch((error) => {
                    console.log(`Failed to register and cache: ${edmFile._id} - ${error}`);
                });
            } else {
                console.error(error);
            }
        });
    }

    endWalk() {
        console.info(this.lastWalkItems);
        console.log("finished one walk");
    }

    private statsHaveChanged(file: EDMFile, cachedFile: EDMCachedFile) {
        return (file.stats.size !== cachedFile.size ||
                file.stats.mtime.getTime() !== cachedFile.mtime);
    }

    private fileHasChanged(file: EDMFile, cachedFile: EDMCachedFile) {
        return (this.statsHaveChanged(file, cachedFile) ||
                file.hash !== cachedFile.hash);
    }

    // private needsUpload(cachedRecord: EDMCachedFile) {
    //     return _.some(cachedRecord.transfers, {transfer_status: 'new' as TransferStatus});
    // }
    //
    // private pendingTransfers(cachedRecord: EDMCachedFile) {
    //     return _.filter(cachedRecord.transfers, {transfer_status: 'new' as TransferStatus});
    // }

    public registerAndCache(localFile: EDMFile, cachedRecord?: EDMCachedFile): Promise<any> { //:Promise<ApolloQueryResult<any>> {
        return EDMQueries.registerFileWithServer(localFile, this.source.name)
            .then((backendResponse) => {
                let doc: EDMCachedFile = localFile.getPouchDocument();
                if (cachedRecord != null) { // we are updating an existing record
                    doc._id = cachedRecord._id;
                    doc._rev = cachedRecord._rev;
                }
                const gqlResponseTransfers: GQLEdgeList = _.get(backendResponse.data.createOrUpdateFile.file, 'file_transfers', null);
                //doc.transfers = EDMQueries.unpackFileTransferResponse(gqlResponseTransfers);
                let transfers = EDMQueries.unpackFileTransferResponse(gqlResponseTransfers);
                for (let xfer of transfers) {
                    xfer.file_local_id = localFile._id;
                }

                return Promise.all([
                    new Promise((resolve, reject) => { resolve(backendResponse) } ),
                    this.cache.addFile(doc),
                    this.cache.updateFileTransfers(transfers)]);
                //return backendResponse;
            })
            // .catch((error) => {
            //             console.error(`Cache put failed: ${error}`);
            // })
            // .catch((error) => {
            //     // We get the main GQL error from the server in error.message
            //     // and a list in the array errors.graphQLErrors
            //     console.error(`ERROR: ${error}`);
            // });
    }

    private handleError(error: any, job?: any) {
        console.error(error);
        if (error.code == "ENOENT" &&
            error.path === path.resolve(this.source.basepath))
            if (job != null) {
                console.error("stopping cron job");
                job.stop();
            }
    }
}
