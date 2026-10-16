import * as Effect from "../Effect.ts";
import * as Layer from "../Layer.ts";
import type * as Scope from "../Scope.ts";
import * as SqlClient from "../sql/SqlClient.ts";
import * as SqlError from "../sql/SqlError.ts";
import * as Stream from "../Stream.ts";
import { Entry, RemoteEntry, type RemoteId } from "./EventJournal.ts";
import * as EventLogServerUnencrypted from "./EventLogServerUnencrypted.ts";
type StorageOptions = {
    readonly entryTablePrefix?: string;
    readonly remoteIdTable?: string;
    readonly insertBatchSize?: number;
};
/**
 * Creates unencrypted event-log server `Storage` backed by SQL.
 *
 * **Details**
 *
 * The implementation creates tables for the server remote id, store sequences,
 * entries, and session authentication bindings, then persists and streams
 * plaintext remote entries.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const makeStorage: (_options?: StorageOptions | undefined) => Effect.Effect<{
    readonly getId: Effect.Effect<RemoteId>;
    readonly getOrCreateSessionAuthBinding: (publicKey: string, signingPublicKey: Uint8Array<ArrayBuffer>) => Effect.Effect<Uint8Array<ArrayBuffer>>;
    readonly entriesAfter: (storeId: import("./EventLogMessage.ts").StoreId, entry: Entry) => Effect.Effect<Array<Entry>>;
    readonly write: (storeId: import("./EventLogMessage.ts").StoreId, entries: ReadonlyArray<Entry>) => Effect.Effect<ReadonlyArray<RemoteEntry>>;
    readonly changes: (options: {
        readonly storeId: import("./EventLogMessage.ts").StoreId;
        readonly startSequence: number;
        readonly compactors: ReadonlyMap<string, {
            readonly events: ReadonlySet<string>;
            readonly effect: (options: {
                readonly entries: ReadonlyArray<Entry>;
                readonly write: (entry: Entry) => Effect.Effect<void>;
            }) => Effect.Effect<void>;
        }>;
    }) => Stream.Stream<RemoteEntry>;
    readonly withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}, SqlError.SqlError, Scope.Scope | SqlClient.SqlClient>;
/**
 * Provides unencrypted server `Storage` using the SQL-backed implementation.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export declare const layerStorage: (options?: StorageOptions) => Layer.Layer<EventLogServerUnencrypted.Storage, SqlError.SqlError, SqlClient.SqlClient>;
export {};
//# sourceMappingURL=SqlEventLogServerUnencrypted.d.ts.map