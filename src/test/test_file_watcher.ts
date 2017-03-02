const fs = require('fs-extra');
const path = require('path');
import * as tmp from 'tmp';
import {expect} from "chai";
import * as nock from "nock";

import {settings} from "../lib/settings";
import {EDMFileWatcher} from "../lib/file_watcher";
import EDMFile from "../lib/file_tracking";
import {EDMQueries} from "../lib/queries";

describe("file watcher", function () {
    const dataDir = tmp.dirSync({ prefix: 'edmtest_'}).name;
    const dirToIngest = path.join(dataDir, 'tmp');
    let edmBackend: any;
    const mutation_id = 'a44f9922-ebae-4864-ae46-678efa394e7d';
    let tmpFile: string;
    let replyData: any;

    function createNewTmpfile(): string {
        let tmpobj = tmp.fileSync({ dir: dirToIngest, prefix: 'tmp-' });
        fs.outputFileSync(tmpobj.name, 'some data\n', function (err) { console.log(err) });
        return tmpobj.name;
    }

    function prepareForGqlRequest(times: number = 1) {
        edmBackend = nock('http://localhost:4000').log(console.log)
            .defaultReplyHeaders({
                'Content-Type': 'application/json; charset=utf-8'
            })
            .filteringRequestBody(function(body) {
                 return '*';
            })
            .post('/api/v1/graphql', '*')
            .delay(300)
            .times(times)
            .reply(200, JSON.stringify(replyData));
    }

    before("set up test env", () => {
        tmp.setGracefulCleanup();

        const initArgs = {
            dataDir: dataDir,
            serverSettings: {
                host:'localhost:4000',
                token: '_rand0m_JWT_t0ken'}
        };

        settings.parseInitArgs(initArgs);

        fs.mkdirSync(dirToIngest);
        tmpFile = createNewTmpfile();

        replyData = {
            "data": {
                "createOrUpdateFile": {
                    "file": {
                        "filepath": tmpFile,
                        "file_transfers": {
                            "edges": [
                                {
                                    "node": {
                                        "status": "new" as TransferStatus,
                                        "id": "RmlsZVRyYW5zZmVyOmE4MGQ2OTkzLWM0YWEtNDUwNC1iNDYwLWMzNWFjYzgzZjgwOA==",
                                        "destination": {
                                            "host": {
                                                "id": "massive"
                                            }
                                        },
                                        "bytes_transferred": null
                                    }
                                },
                                {
                                    "node": {
                                        "status": "queued" as TransferStatus,
                                        "id": "RmlsZVRyYW5zZmVyOmE4MGQ2OTkzLWM0YWEtNDUwNC1iNDYwLWMzNWFjYzgzZjgwOA==",
                                        "destination": {
                                            "host": {
                                                "id": "mytardis"
                                            }
                                        },
                                        "bytes_transferred": null
                                    }
                                }
                            ]
                        }
                    },
                    "clientMutationId": mutation_id
                }
            }
        }
    });

    afterEach("cleanup after each test", () => {
        nock.cleanAll();
    });

    it("should register and cache new files", (done) => {
        prepareForGqlRequest();
        tmpFile = createNewTmpfile();
        let source: EDMSource = {
            basepath: dirToIngest,
            name: 'test_source',
            id: '__source_UUID__',
            checkMethod: 'manual' as FilesystemMonitorMethod,
        };
        let watcher = new EDMFileWatcher(source);

        const edmFile: EDMFile = new EDMFile(dirToIngest, path.basename(tmpFile));
        watcher.registerAndCache(edmFile)
            .then((backendResponse) => {
                return watcher.cache.getEntry(edmFile);
            }).then((doc) => {
                const expected = EDMQueries.unpackFileTransferResponse(replyData.data.createOrUpdateFile.file.file_transfers);
                expect(doc.transfers[0].status).to.equal(expected[0].status);
                expect(doc.transfers[1].status).to.equal(expected[1].status);
                console.log(doc);
                done();
            })
            .catch((error) => {
                console.error(error);
                done(error);
            });
    });

    it("should list files in a folder", (done) => {
        prepareForGqlRequest(2);
        tmpFile = createNewTmpfile();

        console.log(settings.conf.appSettings.dataDir);
        let watcher = new EDMFileWatcher({'basepath': dirToIngest});
        watcher.endWalk = () => {
            const numfiles = watcher.lastWalkItems.length;
            expect(numfiles).to.be.greaterThan(1);
            watcher.cache._db.allDocs().then((result) => {
                console.log(`allDocs: ${JSON.stringify(result)}`);
                console.log(`numfiles: ${numfiles}`);
                // db adds aren't always complete yet, can be improved
                expect(result.total_rows).to.be.lessThan(numfiles+1);
                done();
            }).catch((error) => {
                console.error(error);
                done(error);
            });
        };
        watcher.walk();
    });

    after(function() {

    })
});
