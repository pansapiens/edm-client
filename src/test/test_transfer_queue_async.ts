
import {expect} from "chai";
import * as nock from "nock";

const fs = require('fs-extra');
const path = require('path');
import * as tmp from 'tmp';

import {settings} from "../lib/settings";
import {TransferQueuePool} from "../lib/transfer_queue";
import EDMFile from "../lib/file_tracking";
import {EDMFileCache} from "../lib/cache";

var eventDebug = require('event-debug');

describe("The transfer _queue ", function () {

    const mutation_id = 'a44f9922-ebae-4864-ae46-678efa394e7d';
    let host: EDMDestinationHost;
    let destination: EDMDestination;
    let source: EDMSource;
    let transfer_job: FileTransferJob;
    const dataDir = getTmpDirPath();

    function getTmpDirPath(prefix='edm_test') {
        return tmp.dirSync({ prefix: prefix}).name;
    }

    function createNewTmpfile(basepath, prefix='tmp-'): string {
        let tmpobj = tmp.fileSync({ dir: basepath, prefix: 'tmp-' });
        fs.outputFileSync(tmpobj.name, "some data\n", function (err) { console.log(err) });
        return tmpobj.name;
    }

    // Using a new random hostname for each test ensures that the EDMDestinationHost is unique for each test.
    // This way we get a fresh TransferStream from the TransfersQueues pool for each test.
    function randomString() {
        return Math.random().toString(36).substring(7);
    }

    function prepareForGqlRequest(replyData: any, times: number = 1): nock.Scope {
        return nock('http://localhost:4000').log(console.log)
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

    function setupSettings() {
        host = {
            id: randomString(),
            transfer_method: "dummy",
            settings: {}
        } as EDMDestinationHost;

        destination = {
            id: randomString(),
            host_id: host.id,
            location: getTmpDirPath('edmtest_destination_'),
            exclusions: []
        } as EDMDestination;

        source = {
            id: randomString(),
            name: "testing source",
            basepath: getTmpDirPath('edmtest_source_'),
            checkMethod: "cron",
            cronTime: "* */30 * * * *",
            destinations: [destination],
        };

        transfer_job = {
            cached_file_id: randomString(),
            source_id: source.id,
            destination_id: destination.id,
            file_transfer_id: randomString(),
        } as FileTransferJob;

        let config = {
            appSettings: {
                "dataDir": dataDir,
                "ignoreServerConfig": true
            },
            sources: [source],
            hosts: [host],
        } as Settings;

        settings.setConfig(config);
    }

    before(function () {
        tmp.setGracefulCleanup();

        let initArgs = {
            dataDir: dataDir,
            serverSettings: {
                host: "localhost:4000",
                token: '_rand0m_JWT_t0ken'
            },
        };
        settings.parseInitArgs(initArgs);
        setupSettings();
    });

    afterEach("cleanup after each test", () => {
        nock.cleanAll();
    });

    it("should add a file to the transfer _queue when it has pending file transfers", function (done) {
        setupSettings();

        let now = Math.floor(Date.now() / 1000);

        let real_file = createNewTmpfile(source.basepath);
        real_file = path.basename(real_file);

        const size = 1024;
        let cachedFile = {
            _id: EDMFile.generateID(source.basepath, real_file),
            remote_id: "some_id_assigned_by_backend_server",
            source_id: source.id,
            mtime: now,
            size: size,
            hash: EDMFile.computeHash(real_file, size, now),
            // transfers: [transferRecord],
        } as EDMCachedFile;

        let transferRecord = {
                _id: randomString(),
                file_local_id: cachedFile._id,
                destination_id: destination.id,
                status: "new",
                bytes_transferred: 0,
        } as EDMCachedFileTransfer;

        let replyData = {
            data: {
                updateFileTransfer: {
                    clientMutationId: mutation_id,
                    file_transfer: {
                        id: transferRecord._id,
                        // status:"new" as TransferStatus,
                        // status: "queued" as TransferStatus,
                        status: "uploading" as TransferStatus,
                        bytes_transferred: 999,
                    },
                }
            }
        };
        let mockBackend = prepareForGqlRequest(replyData, 11);
        mockBackend.persist();

        let tq = TransferQueuePool.getQueue(transferRecord.destination_id);

        eventDebug(tq);

        tq.on('transfer_complete', (transfer_id, bytes) => {
            console.info(`Transfer ${transfer_id} of ${bytes} bytes completed`);
            done();
        });

        let cache = new EDMFileCache();

        cache.updateFileTransfers([transferRecord]).then((result) => {
            return cache.addFile(cachedFile);
        }).then((putResult) => {
            expect(putResult.ok).to.be.true;
            expect(putResult.id).to.equal(cachedFile._id);
            console.log(`Added new file to cache: ${putResult.id}`);
        })
        .catch((error) => {
            console.error(`Cache put failed: ${error}`);
        });
    });

    it("should be able to write many transfer jobs to the _queue, " +
        "receive 'finish' event when done", function (done) {
        const number_of_file_transfers = 10;

        setupSettings();

        let replyData = {
            data: {
                updateFileTransfer: {
                    clientMutationId: mutation_id,
                    file_transfer: {
                        id: '__file_transfer_id__',
                        // status:"new" as TransferStatus,
                        // status: "queued" as TransferStatus,
                        status: "uploading" as TransferStatus,
                        bytes_transferred: 999,
                    },
                }
            }
        };
        // number_of_file_transfers * (DummyTransfer.percent_increment + 2)
        // - One request for new -> queued
        // - 10 requests for each increment in dummy transfer
        // - One request for finished
        let mockBackend = prepareForGqlRequest(replyData, 1);
        mockBackend.persist();

        let completed_transfers = 0;

        let tq = TransferQueuePool.getQueue(destination.id);
        // tq.concurrency = number_of_file_transfers + 1;
        eventDebug(tq);

        tq.on('finish', () => {
            console.log(`Queue ${tq.queue_id} -> 'finish' event`);
        });

        tq.on('transfer_complete', (id, bytes) => {
            console.log(`Transfer ${id} on queue ${tq.queue_id} completed (${bytes} bytes)`);
            completed_transfers++;
            if (completed_transfers == number_of_file_transfers) {
                // expect(mockBackend.isDone()).to.be.true;
                done();
            }
        });

        let jobs: FileTransferJob[] = [];
        for (let n=0; n < number_of_file_transfers; n++) {
            let job = {
                cached_file_id: randomString(),
                source_id: source.id,
                destination_id: destination.id,
                file_transfer_id: randomString(),
            } as FileTransferJob;
            jobs.push(job);
            let unsaturated = tq.queueTask(job);
            expect(unsaturated).to.be.true;
        }
    });
});
