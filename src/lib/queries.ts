const uuidV4 = require('uuid/v4');
import gql from "graphql-tag/index";
import * as _ from "lodash";

import {MutationOptions} from "apollo-client";
import {ApolloQueryResult} from "apollo-client";
import {ObservableQuery} from "apollo-client";

import {EDMConnection} from "../edmKit/connection";
import EDMFile from "./file_tracking";

export class EDMQueries {

    public static configQuery(connection: EDMConnection,
                              variables = {}): ObservableQuery {
        const query = gql`query MeQuery {
                              currentClient {
                                id
                                attributes
                                  sources {
                                  id
                                  name
                                  destinations {
                                    id
                                    base
                                    hostId
                                  }
                                }
                                hosts {
                                  id
                                  settings
                                  name
                                }
                              }
                            }`;
        return connection.watchQuery({
            query: query,
            variables: variables,
        });
    }

    public static checkFileQuery(file: EDMFile, source_name: string) {
        return gql`query checkFile {
                      currentClient {
                        sources(id: "${source_name}") {
                          file(id: "${file._id}") {
                            status
                            stats
                          }
                        }
                      }
                    }`;
    }

    public static createOrUpdateFile(
        file: EDMFile,
        source_name: string,
        mutation_id?: string) : MutationOptions {

        if (mutation_id == null) {
            mutation_id = uuidV4();
        }

        const mutation = gql`
            mutation createOrUpdateFile($input: CreateOrUpdateFileInput!) {
                createOrUpdateFile(input: $input) {
                 clientMutationId
                    file {
                      filepath
                      fileTransfers(first: 999) {
                        edges {
                          node {
                            id
                            status
                            bytesTransferred
                            destination {
                              hostId
                            }
                          }
                        }
                      }
                    }
                  }
              }`;
        const vars = {
            "input": {
                "clientMutationId": mutation_id,
                "source": {"name": source_name},
                // "file": file.getGqlVariables(),
                "file": EDMQueries.getEDMFileGqlVariables(file),
            }
        };

        return {
            mutation: mutation,
            variables: vars
        } as MutationOptions;
    }

    public static getEDMFileGqlVariables(file: EDMFile) {
        let variables = _.pick(file.stats, ['size', 'mtime', 'atime', 'ctime', 'birthtime', 'mode']);
        variables['filepath'] = file.filepath;
        return variables;
    }

    public static registerFileWithServer(
                                  connection: EDMConnection,
                                  file: EDMFile,
                                  source_name: string,
                                  mutation_id?: string): Promise<ApolloQueryResult> {

        const mutation = EDMQueries.createOrUpdateFile(
            file,
            source_name,
            mutation_id);

        return connection.mutate(mutation);
            // .then((value) => {
            //         console.log(JSON.stringify(value));
            //         return value;
            // });
    }

    public static updateFileTransfer(connection: EDMConnection,
                                     transfer: EDMCachedFileTransfer): Promise<ApolloQueryResult> {
        const query = gql`
        mutation updateFileTransfer($input: UpdateFileTransferInput!) {
         updateFileTransfer(input: $input) {
          clientMutationId
          fileTransfers(first: 999) {
            edges {
              node {
                status
                bytesTransferred
                destination {
                  hostId
                }
              }
            }
          }
         }
        }
        `;
        const mutation = {
            mutation: query,
            variables: {
                id: transfer.id,
                bytes_transferred: transfer.bytes_transferred,
                status: transfer.status,
            }
        } as MutationOptions;

        return connection.mutate(mutation);
    }
}
